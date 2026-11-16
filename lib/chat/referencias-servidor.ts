/**
 * El buscador del menú @ del chat, del lado del servidor
 * (`app/api/chat/referencias`).
 *
 * Todos los roles pueden referenciar todo, pero cada uno lee con su sesión: los
 * pedidos y los clientes escritos en ellos salen de funciones de la base que ya
 * esconden el teléfono a quien no lo ve (`20261129000200_chat_referencias.sql`),
 * los diseños de `cad_disenos` con la RLS de siempre y los clientes de Odoo del
 * índice del servidor, quitándoles el teléfono antes de responder si el rol no
 * lo puede ver. Buscar por teléfono sí se puede: así el taller ubica al cliente
 * que llama.
 *
 * Lo que va dentro de una referencia queda guardado en el mensaje y lo leen
 * todos los del chat: nunca lleva el teléfono, aunque quien la eligió lo vea.
 */

import { Buscador, compactar, tipoDeDocumento } from "@/lib/busqueda-inteligente";
import { normalizar } from "@/lib/busqueda";
import { urlMiniatura } from "@/lib/cad/miniatura-url";
import { colorDe, espesorTexto, medidaDe } from "@/lib/cortes/catalogo";
import { cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
import { ESTADOS, ROLES, type Estado } from "@/lib/dominio";
import { buscarClientes, indiceClientes } from "@/lib/odoo/catalogos";
import { leerCliente } from "@/lib/odoo/clientes";
import { odooConfigurado } from "@/lib/odoo/rpc";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import type { Perfil } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import {
  nombreDeCliente,
  partnerDeCliente,
  recortar,
  type FichaCliente,
  type FichaPlancha,
  type NivelReferencia,
  type OpcionReferencia,
  type ReferenciaNueva,
  type RespuestaReferencias,
} from "./referencias";
import { opcionesDePlanchas } from "./referencias-planchas";
import type { ContextoReferencia, TipoReferencia } from "./tipos";

const LIMITE = 20;
/** Para "diseños de un cliente": los ítems de sus pedidos más recientes, no de toda la historia. */
const PEDIDOS_CON_DISENOS = 8;

type Supabase = Awaited<ReturnType<typeof clienteServidor>>;

export interface EntradaReferencias {
  tipo: TipoReferencia;
  q: string;
  /** Las fichas encadenadas antes del `@` (`@Juan Pérez @pedido`). */
  contexto: ContextoReferencia[];
  /** Dónde está parado el menú al navegar por niveles. */
  nivel: NivelReferencia;
}

interface FilaPedido {
  codigo: string;
  nombre_cliente: string;
  estado: Estado;
  fecha_creacion: string;
  fecha_prometida: string;
}

const respuesta = (opciones: OpcionReferencia[], titulo: string | null = null, aviso: string | null = null): RespuestaReferencias => ({
  opciones: opciones.slice(0, LIMITE),
  titulo,
  aviso,
});

/** "DNI 12345678", "RUC 20…": lo que distingue a dos clientes con el mismo nombre. */
function documentoTexto(documento: string | null): string | null {
  if (!documento) return null;
  const tipo = tipoDeDocumento(documento);
  return tipo ? `${tipo} ${documento}` : documento;
}

const unir = (...partes: (string | null | undefined | false)[]) => partes.filter(Boolean).join(" · ");

export async function buscarReferencias(perfil: Perfil, e: EntradaReferencias): Promise<RespuestaReferencias> {
  const supabase = await clienteServidor();
  switch (e.tipo) {
    case "cliente":
      return buscarClientesRef(supabase, perfil, e.q);
    case "pedido": {
      const cliente = e.contexto.find((c) => c.tipo === "cliente");
      return cliente ? pedidosDeClienteRef(supabase, cliente, e.q) : buscarPedidosRef(supabase, e.q);
    }
    case "plancha":
      return respuesta(opcionesDePlanchas(await cargarCatalogoPlanchas(true), e.nivel, e.q, await sobrantesPorGrupo(supabase)));
    case "diseno":
      return buscarDisenosRef(supabase, perfil, e);
    case "usuario":
      return buscarUsuariosRef(supabase, perfil, e.q);
  }
}

// ── Clientes ────────────────────────────────────────────────────────────────

/** Un cliente de Odoo como opción. El teléfono, solo en la fila del menú y solo si el rol lo ve. */
function opcionClienteOdoo(c: ClienteOdoo, verTelefono: boolean): OpcionReferencia {
  const documento = documentoTexto(c.documento);
  return {
    clave: `o:${c.id}`,
    etiqueta: c.nombre,
    detalle: unir(documento, verTelefono && c.telefono, c.ciudad) || undefined,
    referencia: {
      tipo: "cliente",
      id: String(c.id),
      etiqueta: recortar(c.nombre),
      detalle: unir(documento, c.ciudad) || undefined,
      datos: { documento: c.documento },
    },
  };
}

interface FilaClienteTexto {
  nombre: string;
  telefono: string | null;
  pedidos: number;
  ultimo: string;
}

function opcionClienteTexto(c: FilaClienteTexto, verTelefono: boolean): OpcionReferencia {
  const pedidos = `${c.pedidos} ${c.pedidos === 1 ? "pedido" : "pedidos"}`;
  return {
    clave: `n:${normalizar(c.nombre)}`,
    etiqueta: c.nombre,
    detalle: unir(verTelefono && c.telefono, pedidos),
    referencia: {
      tipo: "cliente",
      id: recortar(`n:${c.nombre}`, 120),
      etiqueta: recortar(c.nombre),
      detalle: pedidos,
    },
  };
}

/**
 * Odoo primero (nombre, RUC/DNI o teléfono, con errores de tipeo) y, detrás, los
 * clientes que solo existen como texto en los pedidos y Odoo no trajo. Sin Odoo,
 * o si no responde, solo los de los pedidos.
 */
async function buscarClientesRef(supabase: Supabase, perfil: Perfil, q: string): Promise<RespuestaReferencias> {
  const verTelefono = ROLES[perfil.rol].verTelefonoCliente;
  let aviso: string | null = null;
  const opciones: OpcionReferencia[] = [];

  if (q && odooConfigurado()) {
    try {
      const { resultados } = await buscarClientes(q);
      opciones.push(...resultados.map((r) => opcionClienteOdoo(r.item, verTelefono)));
    } catch (error) {
      console.error("[chat] búsqueda de clientes en Odoo", error);
      aviso = "Odoo no respondió: se muestran los clientes escritos en los pedidos.";
    }
  }

  const { data, error } = await supabase.rpc("clientes_de_pedidos", { p_q: q });
  if (error) throw new Error(`No se pudieron buscar los clientes: ${error.message}`);
  const yaEstan = new Set(opciones.map((o) => normalizar(o.etiqueta)));
  for (const fila of (data ?? []) as FilaClienteTexto[]) {
    if (!yaEstan.has(normalizar(fila.nombre))) opciones.push(opcionClienteTexto(fila, verTelefono));
  }
  return respuesta(opciones, null, aviso);
}

/** El partner de Odoo de un cliente referenciado: del índice, o de Odoo si el índice no lo tiene. */
async function clienteOdoo(id: number): Promise<ClienteOdoo | null> {
  if (!odooConfigurado()) return null;
  try {
    return indiceClientes().obtener(id) ?? (await leerCliente(id));
  } catch (error) {
    console.error("[chat] cliente de Odoo", error);
    return null;
  }
}

/** Los pedidos de un cliente: por su partner y, de respaldo, por su nombre y teléfono en texto. */
async function pedidosDe(supabase: Supabase, cliente: Pick<ContextoReferencia, "id" | "etiqueta">): Promise<FilaPedido[]> {
  const partner = partnerDeCliente(cliente.id);
  const odoo = partner ? await clienteOdoo(partner) : null;
  const { data, error } = await supabase.rpc("pedidos_de_cliente", {
    p_partner_id: partner,
    p_nombre: odoo?.nombre ?? nombreDeCliente(cliente),
    p_telefono: odoo?.telefono ?? null,
  });
  if (error) throw new Error(`No se pudieron leer los pedidos del cliente: ${error.message}`);
  return (data ?? []) as FilaPedido[];
}

// ── Pedidos ─────────────────────────────────────────────────────────────────

function opcionPedido(p: FilaPedido, contexto?: ContextoReferencia[]): OpcionReferencia {
  const estado = ESTADOS[p.estado] ?? p.estado;
  return {
    clave: `p:${p.codigo}`,
    etiqueta: p.codigo,
    detalle: unir(p.nombre_cliente, estado),
    referencia: {
      tipo: "pedido",
      id: p.codigo,
      etiqueta: p.codigo,
      detalle: recortar(unir(p.nombre_cliente, estado), 200),
      contexto: contexto?.length ? contexto : undefined,
      datos: { estado: p.estado },
    },
  };
}

/** Lo escrito filtra por código (compactado) o por nombre del cliente. */
const filtraPedido = (q: string) => {
  const c = compactar(q);
  const n = normalizar(q);
  return (p: FilaPedido) => !c || compactar(p.codigo).includes(c) || normalizar(p.nombre_cliente).includes(n);
};

async function buscarPedidosRef(supabase: Supabase, q: string): Promise<RespuestaReferencias> {
  const { data, error } = await supabase.rpc("buscar_pedidos_chat", { p_q: q });
  if (error) throw new Error(`No se pudieron buscar los pedidos: ${error.message}`);
  return respuesta(((data ?? []) as FilaPedido[]).map((p) => opcionPedido(p)));
}

async function pedidosDeClienteRef(supabase: Supabase, cliente: ContextoReferencia, q: string): Promise<RespuestaReferencias> {
  const pedidos = (await pedidosDe(supabase, cliente)).filter(filtraPedido(q));
  return respuesta(
    pedidos.map((p) => opcionPedido(p, [cliente])),
    `Pedidos de ${cliente.etiqueta}`,
  );
}

// ── Diseños 3D ──────────────────────────────────────────────────────────────

interface ItemConDiseno {
  codigo: string;
  posicion: number;
  producto: string;
  disenoId: string;
  version: number;
  versionId: string;
}

/** Los ítems de un pedido que tienen un diseño 3D (`lineas_de_pedido`). */
async function itemsConDiseno(supabase: Supabase, codigo: string): Promise<ItemConDiseno[]> {
  const { data, error } = await supabase.rpc("lineas_de_pedido", { p_codigo: codigo });
  if (error) throw new Error(`No se pudieron leer los ítems de ${codigo}: ${error.message}`);
  return (data ?? []).flatMap((l) =>
    l.diseno_id && l.diseno_version_id
      ? [
          {
            codigo,
            posicion: l.posicion,
            producto: (l.producto_nombre || l.descripcion || "Ítem").trim(),
            disenoId: l.diseno_id,
            version: l.diseno_version,
            versionId: l.diseno_version_id,
          },
        ]
      : [],
  );
}

/**
 * El nombre de cada diseño y la foto de cada versión. Con la RLS de quien
 * pregunta: si su rol todavía no lee `cad_*`, el ítem se nombra igual por su
 * producto, solo que sin foto.
 */
async function nombresYFotos(supabase: Supabase, items: ItemConDiseno[]) {
  const ids = [...new Set(items.map((i) => i.disenoId))];
  const versiones = [...new Set(items.map((i) => i.versionId))];
  if (!ids.length) return { nombres: new Map<string, string>(), fotos: new Map<string, string | null>() };
  const [disenos, fotos] = await Promise.all([
    supabase.from("cad_disenos").select("id, nombre").in("id", ids),
    supabase.from("cad_diseno_versiones").select("id, miniatura_path").in("id", versiones),
  ]);
  return {
    nombres: new Map((disenos.data ?? []).map((d) => [d.id, d.nombre])),
    fotos: new Map((fotos.data ?? []).map((v) => [v.id, urlMiniatura(v.miniatura_path)])),
  };
}

/** "Ítem 2 · Caja 20×20". */
const etiquetaItem = (i: Pick<ItemConDiseno, "posicion" | "producto">) => `Ítem ${i.posicion} · ${i.producto}`;

/**
 * Las opciones de los ítems con diseño. `conPedido`: la etiqueta lleva el código
 * del pedido, porque nada alrededor de la ficha lo dice (sin un `@pedido` antes).
 */
async function opcionesDeItems(
  supabase: Supabase,
  items: ItemConDiseno[],
  contextoDe: (i: ItemConDiseno) => ContextoReferencia[],
  conPedido: boolean,
  q: string,
): Promise<OpcionReferencia[]> {
  const { nombres, fotos } = await nombresYFotos(supabase, items);
  const n = normalizar(q);
  return items
    .filter((i) => !n || normalizar(`${i.codigo} ${etiquetaItem(i)} ${nombres.get(i.disenoId) ?? ""}`).includes(n))
    .map((i) => {
      const item = etiquetaItem(i);
      const etiqueta = conPedido ? `${i.codigo} · ${item}` : item;
      const detalle = unir(nombres.get(i.disenoId) ?? "Diseño 3D", `v${i.version}`);
      return {
        clave: `i:${i.codigo}:${i.posicion}`,
        etiqueta,
        detalle,
        miniatura: fotos.get(i.versionId) ?? null,
        referencia: {
          tipo: "diseno",
          id: i.disenoId,
          etiqueta: recortar(etiqueta),
          detalle,
          contexto: contextoDe(i),
          datos: { version: i.version, pedido: i.codigo, posicion: i.posicion },
        } satisfies ReferenciaNueva,
      };
    });
}

/** Los diseños por su nombre, los más recientes primero. Con la RLS de quien busca. */
async function disenosPorNombre(supabase: Supabase, q: string): Promise<OpcionReferencia[]> {
  const { data, error } = await supabase
    .from("cad_disenos")
    .select("id, nombre, version_actual, actualizado_en")
    .gt("version_actual", 0)
    .order("actualizado_en", { ascending: false })
    .limit(300);
  if (error) return [];
  const disenos = data ?? [];
  const elegidos = q
    ? new Buscador(disenos, (d) => ({ nombre: d.nombre })).buscar(q, { limite: LIMITE }).map((x) => x.item)
    : disenos.slice(0, LIMITE);
  if (!elegidos.length) return [];

  const { data: versiones } = await supabase
    .from("cad_diseno_versiones")
    .select("diseno_id, version, miniatura_path")
    .in("diseno_id", elegidos.map((d) => d.id));
  const foto = new Map((versiones ?? []).map((v) => [`${v.diseno_id}:${v.version}`, urlMiniatura(v.miniatura_path)]));

  return elegidos.map((d) => ({
    clave: `d:${d.id}`,
    etiqueta: d.nombre,
    detalle: `v${d.version_actual}`,
    miniatura: foto.get(`${d.id}:${d.version_actual}`) ?? null,
    referencia: { tipo: "diseno", id: d.id, etiqueta: recortar(d.nombre), detalle: `v${d.version_actual}` },
  }));
}

/**
 * `@diseno3D`. Tres caminos al mismo diseño:
 *   - con un pedido (encadenado o elegido en el menú): los ítems de ese pedido;
 *   - con un cliente: los ítems con diseño de sus pedidos recientes;
 *   - sin nada: por el nombre del diseño, y además los clientes y pedidos que
 *     coinciden con lo escrito, para bajar por cliente › pedido › ítem.
 */
async function buscarDisenosRef(supabase: Supabase, perfil: Perfil, e: EntradaReferencias): Promise<RespuestaReferencias> {
  const encadenado = e.contexto;
  const cliente = e.nivel.cliente ?? encadenado.find((c) => c.tipo === "cliente");
  const pedido = e.nivel.pedido ?? encadenado.find((c) => c.tipo === "pedido")?.id;

  if (pedido) {
    const items = await itemsConDiseno(supabase, pedido);
    // La ficha guarda de dónde salió: lo encadenado o el camino del menú.
    const ruta: ContextoReferencia[] = encadenado.length
      ? encadenado
      : [...(cliente ? [cliente] : []), { tipo: "pedido", id: pedido, etiqueta: pedido }];
    const pedidoEnTexto = encadenado.some((c) => c.tipo === "pedido");
    const opciones = await opcionesDeItems(supabase, items, () => ruta, !pedidoEnTexto, e.q);
    return respuesta(opciones, `Diseños del pedido ${pedido}`, items.length ? null : "Este pedido no tiene diseños 3D.");
  }

  if (cliente) {
    const pedidos = (await pedidosDe(supabase, cliente)).slice(0, PEDIDOS_CON_DISENOS);
    const items = (await Promise.all(pedidos.map((p) => itemsConDiseno(supabase, p.codigo)))).flat();
    const opciones = await opcionesDeItems(
      supabase,
      items,
      (i) => [cliente, { tipo: "pedido", id: i.codigo, etiqueta: i.codigo }],
      true,
      e.q,
    );
    return respuesta(
      opciones,
      `Diseños de ${cliente.etiqueta}`,
      items.length ? null : "Sus pedidos recientes no tienen diseños 3D.",
    );
  }

  const [porNombre, clientes, pedidos] = await Promise.all([
    disenosPorNombre(supabase, e.q),
    e.q ? buscarClientesRef(supabase, perfil, e.q) : null,
    e.q ? buscarPedidosRef(supabase, e.q) : null,
  ]);
  // Clientes y pedidos no se eligen aquí: se entra a ellos para ver sus diseños.
  const navegar = [
    ...(pedidos?.opciones ?? []).slice(0, 5).map((o): OpcionReferencia => ({
      clave: o.clave,
      etiqueta: o.etiqueta,
      detalle: unir(o.detalle, "ver sus ítems"),
      navegable: { pedido: o.etiqueta, migas: [o.etiqueta] },
    })),
    ...(clientes?.opciones ?? []).slice(0, 5).flatMap((o): OpcionReferencia[] =>
      o.referencia
        ? [
            {
              clave: o.clave,
              etiqueta: o.etiqueta,
              detalle: "Cliente · ver sus diseños",
              navegable: {
                cliente: { tipo: "cliente", id: o.referencia.id, etiqueta: o.referencia.etiqueta },
                migas: [o.referencia.etiqueta],
              },
            },
          ]
        : [],
    ),
  ];
  return respuesta([...porNombre, ...navegar]);
}

// ── Usuarios ────────────────────────────────────────────────────────────────

async function buscarUsuariosRef(supabase: Supabase, perfil: Perfil, q: string): Promise<RespuestaReferencias> {
  const { data, error } = await supabase.rpc("directorio_usuarios");
  if (error) throw new Error(`No se pudo leer el directorio: ${error.message}`);
  // Uno no se menciona a sí mismo: no le llegaría nada.
  const usuarios = (data ?? []).filter((u) => u.id !== perfil.id);
  const elegidos = q
    ? new Buscador(usuarios, (u) => ({ nombre: u.nombre, codigos: [u.usuario] })).buscar(q, { limite: LIMITE }).map((x) => x.item)
    : usuarios;
  return respuesta(
    elegidos.map((u) => ({
      clave: `u:${u.id}`,
      etiqueta: u.nombre,
      detalle: ROLES[u.rol].nombre,
      referencia: {
        tipo: "usuario",
        id: u.id,
        etiqueta: recortar(u.nombre),
        detalle: ROLES[u.rol].nombre,
        datos: { rol: u.rol, usuario: u.usuario },
      },
    })),
  );
}

// ── Planchas ────────────────────────────────────────────────────────────────

/** Los retazos disponibles por grupo (`sobrantes`, que leen los tres roles). */
async function sobrantesPorGrupo(supabase: Supabase, grupoId?: string): Promise<Map<string, number>> {
  let consulta = supabase.from("sobrantes").select("grupo_id").eq("estado", "disponible");
  if (grupoId) consulta = consulta.eq("grupo_id", grupoId);
  const { data } = await consulta;
  const cuenta = new Map<string, number>();
  for (const s of data ?? []) cuenta.set(s.grupo_id, (cuenta.get(s.grupo_id) ?? 0) + 1);
  return cuenta;
}

// ── Las tarjetas de una ficha ───────────────────────────────────────────────

/**
 * Lo que se ve al tocar una ficha de cliente o de plancha, leído ahora (no la
 * foto del mensaje) y con lo que el rol de quien mira puede ver.
 */
export async function fichaDeReferencia(
  perfil: Perfil,
  tipo: "cliente" | "plancha",
  id: string,
  etiqueta: string,
): Promise<FichaCliente | FichaPlancha | null> {
  const supabase = await clienteServidor();
  return tipo === "cliente" ? fichaCliente(supabase, perfil, id, etiqueta) : fichaPlancha(supabase, id);
}

async function fichaCliente(supabase: Supabase, perfil: Perfil, id: string, etiqueta: string): Promise<FichaCliente> {
  const verTelefono = ROLES[perfil.rol].verTelefonoCliente;
  const partner = partnerDeCliente(id);
  const odoo = partner ? await clienteOdoo(partner) : null;
  const nombre = odoo?.nombre ?? nombreDeCliente({ id, etiqueta });

  const [pedidos, texto] = await Promise.all([
    pedidosDe(supabase, { id, etiqueta }),
    // El teléfono de un cliente de texto: el de su pedido más reciente (la base lo esconde si no se ve).
    odoo ? null : supabase.rpc("clientes_de_pedidos", { p_q: nombre }),
  ]);
  const deTexto = ((texto?.data ?? []) as FilaClienteTexto[]).find((c) => normalizar(c.nombre) === normalizar(nombre));

  return {
    tipo: "cliente",
    nombre,
    documento: documentoTexto(odoo?.documento ?? null),
    telefono: verTelefono ? (odoo?.telefono ?? deTexto?.telefono ?? null) : null,
    ciudad: odoo?.ciudad ?? null,
    pedidos: pedidos.slice(0, 5).map((p) => ({
      codigo: p.codigo,
      estado: ESTADOS[p.estado] ?? p.estado,
      fechaCreacion: p.fecha_creacion,
    })),
  };
}

async function fichaPlancha(supabase: Supabase, id: string): Promise<FichaPlancha | null> {
  const catalogo = await cargarCatalogoPlanchas();
  const [clase, valor] = [id.slice(0, 2), id.slice(2)];
  const grupo =
    clase === "g:"
      ? catalogo.find((g) => g.id === valor)
      : clase === "f:"
        ? catalogo.find((g) => g.formatos.some((f) => f.id === valor))
        : undefined;
  if (!grupo) return null;
  const sobrantes = await sobrantesPorGrupo(supabase, grupo.id);
  return {
    tipo: "plancha",
    material: grupo.material,
    color: colorDe(grupo),
    espesor: espesorTexto(grupo.espesorMm),
    formatoId: clase === "f:" ? valor : null,
    formatos: grupo.formatos
      .filter((f) => f.activo || f.id === valor)
      .map((f) => ({ id: f.id, codigo: f.codigo, medida: `${medidaDe(f)} cm` })),
    sobrantes: sobrantes.get(grupo.id) ?? 0,
  };
}
