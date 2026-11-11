/**
 * Los sobrantes del lado del servidor: leerlos de Supabase, registrarlos y
 * mantener la tabla al día con Odoo.
 *
 * Como en el resto de la app, todo va con la sesión de quien pide. La tabla la
 * leen y escriben los tres roles (su RLS); a Odoo se va con la cuenta del
 * servidor.
 */

import { cargarCatalogoPlanchas } from "./cortes-servidor";
import { pideColor, type GrupoPlancha } from "./cortes/catalogo";
import { mensajeDeError } from "./errores";
import type { NuevoSobrante } from "./esquemas";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import {
  PREFIJO_PRODUCTO,
  anotarLote,
  crearLoteSobrante,
  lotesEnStock,
} from "./odoo/sobrantes";
import {
  esEstandar,
  leerNotaDeLote,
  materialDeSobrante,
  materialOdoo,
  notaDeLote,
  normalizarMedidas,
  ordenDeUso,
  type EstadoSobrante,
  type OrigenSobrante,
  type Sobrante,
  type SincronizacionSobrante,
} from "./sobrantes";
import { clienteServidor } from "./supabase-servidor";

const COLUMNAS = `
  id, codigo, grupo_id, color, largo_cm, ancho_cm, ubicacion, estado, estandar, origen,
  odoo_lot_id, sincronizacion, error_sincronizacion, creado_en, linea_posicion,
  grupo:grupos_plancha ( material, variante, detalle, espesor_mm ),
  nacio:pedidos!sobrantes_pedido_id_fkey ( codigo ),
  reserva:pedidos!sobrantes_reserva_pedido_id_fkey ( codigo )
`;

interface Fila {
  id: string;
  codigo: string;
  grupo_id: string;
  color: string | null;
  largo_cm: number;
  ancho_cm: number;
  ubicacion: string | null;
  estado: EstadoSobrante;
  estandar: boolean;
  origen: string;
  odoo_lot_id: number | null;
  sincronizacion: SincronizacionSobrante;
  error_sincronizacion: string | null;
  creado_en: string;
  linea_posicion: number | null;
  grupo: { material: string; variante: string; detalle: string; espesor_mm: number } | null;
  nacio: { codigo: string } | null;
  reserva: { codigo: string } | null;
}

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function deFila(f: Fila): Sobrante {
  const g = uno(f.grupo);
  return {
    id: f.id,
    codigo: f.codigo,
    grupoId: f.grupo_id,
    material: g
      ? materialDeSobrante(
          { material: g.material, variante: g.variante, detalle: g.detalle, espesorMm: Number(g.espesor_mm) },
          f.color,
        )
      : "(material borrado)",
    color: f.color,
    largo: Number(f.largo_cm),
    ancho: Number(f.ancho_cm),
    ubicacion: f.ubicacion,
    estado: f.estado,
    estandar: f.estandar,
    pedido: uno(f.reserva)?.codigo ?? null,
    nacioEn: uno(f.nacio)?.codigo ?? null,
    lineaPosicion: f.linea_posicion,
    origen: f.origen as OrigenSobrante,
    odooLotId: f.odoo_lot_id,
    sincronizacion: f.sincronizacion,
    errorSincronizacion: f.error_sincronizacion,
    creadoEn: f.creado_en,
  };
}

/** Todos: los consumidos y de baja también, para buscar una etiqueta vieja. */
export async function cargarSobrantes(): Promise<Sobrante[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("sobrantes").select(COLUMNAS).order("creado_en", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los sobrantes: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(deFila);
}

export interface SobranteDisponible {
  codigo: string;
  largo: number;
  ancho: number;
  color: string | null;
  estandar: boolean;
  creadoEn: string;
}

/**
 * Los sobrantes de un material que se pueden usar en un corte: disponibles y ya
 * en Odoo (con su lote), en el orden en que conviene usarlos.
 */
export async function sobrantesDisponibles(grupoId: string): Promise<SobranteDisponible[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("sobrantes")
    .select("codigo, largo_cm, ancho_cm, color, estandar, creado_en")
    .eq("grupo_id", grupoId)
    .eq("estado", "disponible")
    .eq("sincronizacion", "sincronizada")
    .not("odoo_lot_id", "is", null);
  if (error) throw new Error(`No se pudieron leer los sobrantes: ${error.message}`);
  return ordenDeUso(
    (data ?? []).map((f) => ({
      codigo: f.codigo,
      largo: Number(f.largo_cm),
      ancho: Number(f.ancho_cm),
      color: f.color,
      estandar: f.estandar,
      creadoEn: f.creado_en,
    })),
  );
}

/** Los que un pedido devolvió al almacén (sin los dados de baja). */
export async function cargarSobrantesDePedido(codigoPedido: string): Promise<Sobrante[]> {
  const supabase = await clienteServidor();
  const { data: pedido } = await supabase.from("pedidos").select("id").eq("codigo", codigoPedido).maybeSingle();
  if (!pedido) return [];
  const { data, error } = await supabase
    .from("sobrantes")
    .select(COLUMNAS)
    .eq("pedido_id", pedido.id)
    .eq("origen", "corte")
    .neq("estado", "baja")
    .order("codigo");
  if (error) throw new Error(`No se pudieron leer los sobrantes del pedido: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(deFila);
}

export async function cargarSobrante(codigo: string): Promise<Sobrante | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("sobrantes").select(COLUMNAS).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`No se pudo leer el sobrante: ${error.message}`);
  return data ? deFila(data as unknown as Fila) : null;
}

/* ── Odoo ──────────────────────────────────────────────────────────────────── */

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[sobrantes] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

/**
 * Crea en Odoo el lote de un sobrante que todavía no lo tiene, y anota el
 * resultado. Si falla, queda el motivo y la pantalla ofrece reintentar, que no
 * duplica (el lote se busca por su nombre antes de crearlo).
 */
export async function llevarAOdoo(codigo: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const s = await cargarSobrante(codigo);
  if (!s) return { ok: false, error: "Ese sobrante ya no existe." };
  if (s.sincronizacion === "sincronizada" && s.odooLotId) return { ok: true };
  /* Uno que salió de un corte entra a Odoo por la orden de fabricación de su
     pedido, al cerrarla: crearlo aquí lo pondría dos veces en el stock. */
  if (s.origen === "corte") {
    return {
      ok: false,
      error: `Este sobrante entra a Odoo al cerrar la producción de ${s.nacioEn ? `el pedido ${s.nacioEn}` : "su pedido"}: reintenta desde el pedido.`,
    };
  }

  const anotar = async (cambios: { odoo_lot_id?: number; sincronizacion: SincronizacionSobrante; error_sincronizacion: string | null }) => {
    const { error } = await supabase.from("sobrantes").update(cambios).eq("codigo", codigo);
    return error;
  };

  if (!odooConfigurado()) {
    await anotar({ sincronizacion: "error", error_sincronizacion: ODOO_NO_CONFIGURADO });
    return { ok: false, error: ODOO_NO_CONFIGURADO };
  }

  const grupo = (await cargarCatalogoPlanchas()).find((g) => g.id === s.grupoId);
  const material = grupo ? materialOdoo(grupo) : null;
  if (!material) {
    const error = "El material de este sobrante ya no tiene planchas en el catálogo.";
    await anotar({ sincronizacion: "error", error_sincronizacion: error });
    return { ok: false, error };
  }

  try {
    const loteId = await crearLoteSobrante({
      material,
      nombre: s.codigo,
      largo: s.largo,
      ancho: s.ancho,
      nota: notaDeLote(s),
    });
    const error = await anotar({ odoo_lot_id: loteId, sincronizacion: "sincronizada", error_sincronizacion: null });
    if (error) return { ok: false, error: `El lote se creó en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}` };
    return { ok: true };
  } catch (e) {
    const error = mensajeOdoo(e, "crear lote");
    await anotar({ sincronizacion: "error", error_sincronizacion: error });
    return { ok: false, error };
  }
}

export type ResultadoRegistro = { ok: true; codigo: string; aviso?: string } | { ok: false; error: string };

/**
 * Registra a mano un sobrante que ya está en el almacén: primero en la tabla
 * (así no se pierde lo medido si Odoo falla) y después su lote en Odoo.
 */
export async function registrarSobrante(v: NuevoSobrante): Promise<ResultadoRegistro> {
  const supabase = await clienteServidor();
  const grupo = (await cargarCatalogoPlanchas()).find((g) => g.id === v.grupoId);
  if (!grupo) return { ok: false, error: "Ese material ya no está en el catálogo. Vuelve a elegirlo." };
  if (pideColor(grupo) && !v.color) return { ok: false, error: "Escribe el color de la pieza: este material comparte código entre colores." };

  const { largo, ancho } = normalizarMedidas(v.largo, v.ancho);
  const { data: minimo } = await supabase.rpc("retazo_minimo");
  const retazo = Number(minimo ?? 30);
  if (ancho < retazo) {
    return { ok: false, error: `Con un lado menor de ${retazo} cm es retazo: no vuelve al almacén.` };
  }
  const mayor = Math.max(0, ...grupo.formatos.map((f) => Math.max(f.anchoCm, f.largoCm)));
  const menorDelMayor = Math.max(0, ...grupo.formatos.map((f) => Math.min(f.anchoCm, f.largoCm)));
  if (largo > mayor + 1 || ancho > menorDelMayor + 1) {
    return { ok: false, error: "Esas medidas no caben en ninguna plancha de este material. Revisa el largo y el ancho." };
  }

  const { data, error } = await supabase
    .from("sobrantes")
    .insert({
      grupo_id: grupo.id,
      color: pideColor(grupo) ? v.color : null,
      largo_cm: largo,
      ancho_cm: ancho,
      ubicacion: v.ubicacion,
      estandar: esEstandar({ largo, ancho }, grupo.formatos),
      origen: "manual",
    })
    .select("codigo")
    .single();
  if (error || !data) return { ok: false, error: mensajeDeError(error) };

  const odoo = await llevarAOdoo(data.codigo);
  return odoo.ok
    ? { ok: true, codigo: data.codigo }
    : { ok: true, codigo: data.codigo, aviso: `Quedó registrado, pero no se creó en Odoo: ${odoo.error}` };
}

/** Cambia dónde está guardado; si ya está en Odoo, también la nota del lote. */
export async function moverSobrante(codigo: string, ubicacion: string | null) {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("sobrantes")
    .update({ ubicacion })
    .eq("codigo", codigo)
    .select("odoo_lot_id, color")
    .maybeSingle();
  if (error) return { ok: false as const, error: mensajeDeError(error) };
  if (!data) return { ok: false as const, error: "Ese sobrante ya no existe." };

  if (data.odoo_lot_id && odooConfigurado()) {
    try {
      await anotarLote(data.odoo_lot_id, notaDeLote({ ubicacion, color: data.color }));
    } catch (e) {
      return { ok: true as const, aviso: `Se movió aquí, pero no en la nota del lote de Odoo: ${mensajeOdoo(e, "mover")}` };
    }
  }
  return { ok: true as const };
}

export interface ResumenSincronizacion {
  /** Lotes de Odoo que la app no tenía y ahora sí. */
  traidos: number;
  /** Sobrantes que ya no están en el stock de Odoo. */
  agotados: number;
  /** Sobrantes que estaban sin lote y ahora lo tienen. */
  llevados: number;
  /** Lo que no se pudo, en palabras. */
  problemas: string[];
}

/**
 * Pone la tabla de acuerdo con Odoo, que es el que manda:
 *   - lo registrado aquí sin lote se vuelve a llevar;
 *   - un sobrante cuyo lote ya no tiene stock en Odoo se da por consumido;
 *   - un lote de Odoo que la app no conoce se trae, si tiene medidas.
 */
export async function sincronizarSobrantes(): Promise<ResumenSincronizacion> {
  if (!odooConfigurado()) throw new ErrorOdoo(ODOO_NO_CONFIGURADO);
  const supabase = await clienteServidor();
  const resumen: ResumenSincronizacion = { traidos: 0, agotados: 0, llevados: 0, problemas: [] };

  const todos = await cargarSobrantes();
  const sinLote = todos.filter(
    (x) => x.origen !== "corte" && x.sincronizacion !== "sincronizada" && (x.estado === "disponible" || x.estado === "reservado"),
  );
  for (const s of sinLote) {
    const r = await llevarAOdoo(s.codigo);
    if (r.ok) resumen.llevados++;
    else resumen.problemas.push(`${s.codigo}: ${r.error}`);
  }

  const enOdoo = await lotesEnStock();
  const conStock = new Set(enOdoo.map((l) => l.loteId));
  const conocidos = new Set((await cargarSobrantes()).map((s) => s.odooLotId).filter(Boolean));

  const agotados = todos.filter(
    (s) => s.odooLotId && (s.estado === "disponible" || s.estado === "reservado") && !conStock.has(s.odooLotId),
  );
  if (agotados.length) {
    const { error } = await supabase
      .from("sobrantes")
      .update({ estado: "consumido" })
      .in("id", agotados.map((s) => s.id));
    if (error) resumen.problemas.push(`No se pudieron marcar los consumidos: ${mensajeDeError(error)}`);
    else resumen.agotados = agotados.length;
  }

  const catalogo = await cargarCatalogoPlanchas();
  const grupoDe = new Map<string, GrupoPlancha>();
  for (const g of catalogo) {
    const m = materialOdoo(g);
    if (m) grupoDe.set(`${PREFIJO_PRODUCTO}${m.codigoBase}`, g);
  }

  for (const l of enOdoo.filter((x) => !conocidos.has(x.loteId))) {
    const grupo = grupoDe.get(l.codigoProducto);
    if (!grupo) {
      resumen.problemas.push(`${l.nombre}: su producto (${l.codigoProducto}) no corresponde a ningún material del catálogo.`);
      continue;
    }
    if (!l.largo || !l.ancho) {
      resumen.problemas.push(`${l.nombre}: el lote no tiene largo y ancho en Odoo.`);
      continue;
    }
    const medidas = normalizarMedidas(l.largo, l.ancho);
    const nota = leerNotaDeLote(l.nota);
    const datos = {
      grupo_id: grupo.id,
      color: pideColor(grupo) ? nota.color : null,
      largo_cm: medidas.largo,
      ancho_cm: medidas.ancho,
      ubicacion: nota.ubicacion,
      estandar: esEstandar(medidas, grupo.formatos),
      odoo_lot_id: l.loteId,
      sincronizacion: "sincronizada" as const,
      error_sincronizacion: null,
    };
    // El código es el nombre del lote: es lo que dice la etiqueta y lo que Odoo
    // encuentra. Si ya hay uno con ese código (se consumió o se dio de baja y en
    // Odoo volvió a tener stock), es el mismo sobrante que vuelve al almacén.
    const previo = todos.find((s) => s.codigo === l.nombre);
    const { error } = previo
      ? await supabase
          .from("sobrantes")
          .update({ ...datos, estado: "disponible", pedido_id: null })
          .eq("id", previo.id)
      : await supabase.from("sobrantes").insert({ ...datos, codigo: l.nombre, origen: "odoo" });
    if (error) resumen.problemas.push(`${l.nombre}: ${mensajeDeError(error)}`);
    else resumen.traidos++;
  }

  return resumen;
}
