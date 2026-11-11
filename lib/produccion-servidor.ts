/**
 * La producción de los cortes con el piloto de sobrantes, del lado del servidor:
 * crear sus órdenes al confirmar el pedido, guardar los sobrantes que el taller
 * confirma al terminar y cerrar las órdenes con eso.
 *
 * Como el stock, lo pide quien mueve el pedido —que puede ser el taller— y pasa
 * por las funciones de ventanilla de la base (`lineas_de_pedido()`,
 * `anotar_produccion()`). Los sobrantes van a su tabla, que escriben los tres
 * roles.
 */

import { cargarConfigCortes, cargarGrupoPlancha } from "./cortes-servidor";
import { calcularCorte } from "./cortes/calcular";
import { pideColor } from "./cortes/catalogo";
import { guardarCorte, planchasNuevas, sobrantesUsados, type CorteGuardado } from "./cortes/guardado";
import type { Json } from "./supabase-tipos";
import { mensajeDeError } from "./errores";
import { cancelarProduccion, cerrarProduccion, crearProduccion } from "./odoo/produccion";
import { origenDe } from "./odoo/pedidos-venta";
import { ErrorOdoo } from "./odoo/rpc";
import type { LineaDePedido } from "./pedido-lineas";
import {
  areaPiezasM2,
  contenedoresDe,
  esEstandar,
  materialOdoo,
  normalizarMedidas,
  notaDeLote,
  sobrantesDeCorte,
} from "./sobrantes";
import { sobrantesDisponibles } from "./sobrantes-servidor";
import { clienteServidor } from "./supabase-servidor";

type Resultado = { ok: true } | { ok: false; error: string };

const mensaje = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[produccion] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

/** Si la línea es un corte con el piloto encendido (al cotizarse). */
export const conPiloto = (l: { corte: CorteGuardado | null }) => !!l.corte?.sobrantes;


/** Los lotes de Odoo de los sobrantes del almacén que usa un corte. */
async function lotesConsumidos(corte: CorteGuardado): Promise<number[]> {
  const codigos = sobrantesUsados(corte);
  if (codigos.length === 0) return [];
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("sobrantes").select("codigo, odoo_lot_id").in("codigo", codigos);
  if (error) throw new Error(`No se pudieron leer los sobrantes del corte: ${error.message}`);
  const sinLote = codigos.filter((c) => !data?.find((f) => f.codigo === c)?.odoo_lot_id);
  if (sinLote.length) throw new ErrorOdoo(`Los sobrantes ${sinLote.join(", ")} no tienen lote en Odoo.`);
  return codigos.map((c) => data!.find((f) => f.codigo === c)!.odoo_lot_id!);
}

async function retazoMinimo(): Promise<number> {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("retazo_minimo");
  return Number(data ?? 30);
}

/**
 * Crea la orden de fabricación de un corte, si todavía no la tiene, y la anota
 * en su línea. El origen la identifica: repetir no duplica.
 */
async function asegurarProduccion(
  cotizacionId: string,
  l: { posicion: number; productoId: number; corte: CorteGuardado | null; produccionId: number | null },
): Promise<number> {
  if (l.produccionId) return l.produccionId;
  const corte = l.corte!;
  const grupo = await cargarGrupoPlancha(corte.grupoId);
  const material = grupo ? materialOdoo(grupo) : null;
  if (!material) throw new ErrorOdoo("El material del corte ya no tiene planchas en el catálogo.");

  const retazo = await retazoMinimo();
  const mo = await crearProduccion({
    origen: `${origenDe(cotizacionId)} #${l.posicion}`,
    material,
    areaM2: areaPiezasM2(corte.piezas),
    planchaId: l.productoId,
    planchas: planchasNuevas(corte),
    sobrantesPrevistos: sobrantesDeCorte(corte, retazo).map((s) => ({ areaM2: (s.largo * s.ancho) / 10000 })),
    consumidos: await lotesConsumidos(corte),
  });

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("anotar_produccion", {
    p_cotizacion: cotizacionId,
    p_posicion: l.posicion,
    p_id: mo.id,
    p_nombre: mo.nombre,
  });
  if (error) throw new Error(`Se creó ${mo.nombre} en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}`);
  return mo.id;
}

/**
 * Las órdenes de los cortes con piloto de una cotización ya confirmada. Corre
 * después de confirmar la venta: la orden reserva las planchas que el corte va a
 * consumir.
 */
export async function producirCortes(
  cotizacionId: string,
  lineas: { posicion: number; productoId: number; corte: CorteGuardado | null; produccionId?: number | null }[],
): Promise<Resultado> {
  for (const l of lineas.filter(conPiloto)) {
    try {
      await asegurarProduccion(cotizacionId, { ...l, produccionId: l.produccionId ?? null });
    } catch (e) {
      return { ok: false, error: `No se creó la orden de fabricación del corte: ${mensaje(e, "crear")}` };
    }
  }
  return { ok: true };
}

/* ── La reserva ────────────────────────────────────────────────────────────── */

/**
 * Al registrar el pedido, el acomodo de cada corte con piloto se rehace con los
 * sobrantes disponibles en ese momento —los que vio quien cotizó pueden ya no
 * estar— y esos quedan reservados para el pedido, en la misma transacción que
 * guarda el acomodo. Si otro pedido se lleva uno a la vez, se rehace sin él.
 *
 * El precio no cambia: es el de la cotización, salga de donde salga el material.
 */
export async function reservarSobrantes(
  cotizacionId: string,
  lineas: { posicion: number; corte: CorteGuardado | null }[],
): Promise<Resultado> {
  const supabase = await clienteServidor();
  const config = await cargarConfigCortes();

  for (const l of lineas.filter(conPiloto)) {
    const corte = l.corte!;
    const grupo = await cargarGrupoPlancha(corte.grupoId);
    if (!grupo) continue;

    for (let intento = 0; intento < 4; intento++) {
      // El último intento, sin sobrantes: planchas nuevas, que siempre se pueden.
      const disponibles = intento < 3 ? contenedoresDe(await sobrantesDisponibles(grupo.id), pideColor(grupo) ? corte.color : null) : [];
      const calculo = calcularCorte(
        { piezas: corte.piezas, espesorMm: corte.espesorMm, modalidad: corte.modalidad, rotable: corte.rotable },
        corte.formato,
        config,
        disponibles,
      );
      const nuevo: CorteGuardado = {
        ...corte,
        planchas: guardarCorte({ ...corte }, { ...calculo, formato: corte.formato }).planchas,
      };
      const codigos = sobrantesUsados(nuevo);

      const { error } = await supabase.rpc("reservar_sobrantes_de_corte", {
        p_cotizacion: cotizacionId,
        p_posicion: l.posicion,
        p_corte: nuevo as unknown as Json,
        p_codigos: codigos,
      });
      if (!error) break;
      if (!error.message.includes("SOBRANTE_OCUPADO")) {
        return { ok: false, error: `No se reservaron los sobrantes: ${mensajeDeError(error)}` };
      }
      // Otro pedido se llevó alguno a la vez: se vuelve a leer lo disponible.
    }
  }
  return { ok: true };
}

export interface SobranteConfirmado {
  largo: number;
  ancho: number;
  ubicacion: string | null;
}

/**
 * Los sobrantes que el taller dice que guardó de un corte, al pasar a Listo. Se
 * guardan en la tabla antes de ir a Odoo, para que no se pierda lo medido; los
 * de un intento anterior que no llegaron a Odoo se dan de baja y se reemplazan.
 */
export async function guardarSobrantesDeCorte(
  codigoPedido: string,
  linea: LineaDePedido,
  piezas: SobranteConfirmado[],
): Promise<Resultado> {
  const corte = linea.corte;
  if (!corte || !conPiloto(linea)) return { ok: false, error: "Esa línea no es un corte con sobrantes." };
  const supabase = await clienteServidor();
  const [grupo, retazo, pedido] = await Promise.all([
    cargarGrupoPlancha(corte.grupoId),
    retazoMinimo(),
    supabase.from("pedidos").select("id").eq("codigo", codigoPedido).maybeSingle(),
  ]);
  if (!grupo) return { ok: false, error: "El material del corte ya no está en el catálogo." };
  if (!pedido.data) return { ok: false, error: "Ese pedido no existe." };

  for (const p of piezas) {
    const m = normalizarMedidas(p.largo, p.ancho);
    if (m.ancho < retazo) {
      return { ok: false, error: `Un sobrante de ${m.largo}×${m.ancho} es retazo (lado menor de ${retazo} cm): quítalo.` };
    }
  }

  const { error: alLimpiar } = await supabase
    .from("sobrantes")
    .update({ estado: "baja" })
    .eq("pedido_id", pedido.data.id)
    .eq("linea_posicion", linea.posicion)
    .eq("origen", "corte")
    .neq("sincronizacion", "sincronizada");
  if (alLimpiar) return { ok: false, error: mensajeDeError(alLimpiar) };

  if (piezas.length === 0) return { ok: true };
  const { error } = await supabase.from("sobrantes").insert(
    piezas.map((p) => {
      const m = normalizarMedidas(p.largo, p.ancho);
      return {
        grupo_id: grupo.id,
        color: pideColor(grupo) ? corte.color : null,
        largo_cm: m.largo,
        ancho_cm: m.ancho,
        ubicacion: p.ubicacion,
        estandar: esEstandar(m, grupo.formatos),
        origen: "corte",
        pedido_id: pedido.data!.id,
        linea_posicion: linea.posicion,
      };
    }),
  );
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true };
}

/**
 * Cierra en Odoo las órdenes de los cortes con piloto de un pedido terminado:
 * consume las planchas usadas (las anotadas o las calculadas) y crea un lote
 * por cada sobrante guardado. Se puede repetir: lo ya cerrado no se toca.
 */
export async function cerrarCortesDePedido(
  codigoPedido: string,
  cotizacionId: string,
  lineas: LineaDePedido[],
): Promise<Resultado> {
  const pendientes = lineas.filter((l) => conPiloto(l) && !l.produccionCerrada);
  if (pendientes.length === 0) return { ok: true };

  const supabase = await clienteServidor();
  const { data: pedido } = await supabase.from("pedidos").select("id").eq("codigo", codigoPedido).maybeSingle();
  if (!pedido) return { ok: false, error: "Ese pedido no existe." };

  for (const l of pendientes) {
    try {
      const moId = await asegurarProduccion(cotizacionId, l);
      const grupo = await cargarGrupoPlancha(l.corte!.grupoId);
      const material = grupo ? materialOdoo(grupo) : null;
      if (!material) throw new ErrorOdoo("El material del corte ya no tiene planchas en el catálogo.");

      const { data: filas, error } = await supabase
        .from("sobrantes")
        .select("id, codigo, largo_cm, ancho_cm, ubicacion, color")
        .eq("pedido_id", pedido.id)
        .eq("linea_posicion", l.posicion)
        .eq("origen", "corte")
        .neq("estado", "baja");
      if (error) return { ok: false, error: mensajeDeError(error) };

      const lotes = await cerrarProduccion(moId, {
        material,
        consumidos: await lotesConsumidos(l.corte!),
        planchas: l.planchasUsadas ?? planchasNuevas(l.corte!),
        sobrantes: (filas ?? []).map((f) => ({
          nombre: f.codigo,
          largo: Number(f.largo_cm),
          ancho: Number(f.ancho_cm),
          nota: notaDeLote({ ubicacion: f.ubicacion, color: f.color }),
        })),
      });

      for (const f of filas ?? []) {
        await supabase
          .from("sobrantes")
          .update({ odoo_lot_id: lotes.get(f.codigo) ?? null, sincronizacion: "sincronizada", error_sincronizacion: null })
          .eq("id", f.id);
      }
      // Los sobrantes del almacén que usó el corte ya no están.
      await supabase.rpc("soltar_sobrantes_de_pedido", {
        p_codigo: codigoPedido,
        p_consumir: true,
        p_posicion: l.posicion,
      });
      const { error: alAnotar } = await supabase.rpc("anotar_produccion", {
        p_cotizacion: cotizacionId,
        p_posicion: l.posicion,
        p_cerrada: true,
      });
      if (alAnotar) return { ok: false, error: `La orden se cerró en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(alAnotar)}` };
    } catch (e) {
      return { ok: false, error: `No se cerró la orden de fabricación: ${mensaje(e, "cerrar")}` };
    }
  }
  return { ok: true };
}

/** Cancela las órdenes abiertas de un pedido anulado: las planchas que reservaban quedan libres. */
export async function cancelarCortesDePedido(lineas: LineaDePedido[]): Promise<Resultado> {
  for (const l of lineas.filter((x) => conPiloto(x) && x.produccionId && !x.produccionCerrada)) {
    try {
      await cancelarProduccion(l.produccionId!);
    } catch (e) {
      return { ok: false, error: mensaje(e, "cancelar") };
    }
  }
  return { ok: true };
}
