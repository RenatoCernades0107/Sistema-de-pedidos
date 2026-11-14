/**
 * El seguimiento de un pedido tal como lo ve el cliente en `/seguimiento/<token>`.
 *
 * Es una foto recortada (`seguimiento_pedido()` en la base): estado, fechas,
 * entrega y productos sin precios. Nada de montos, teléfonos ni quién hizo qué.
 */

import { leerCorte, type CorteGuardado } from "./cortes/guardado";
import { leerTerminado, type TerminadoGuardado } from "./terminados/guardado";
import type { Estado, LugarEntrega } from "./dominio";

export interface LineaSeguimiento {
  posicion: number;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  cantidad: number;
  corte: CorteGuardado | null;
  terminado: TerminadoGuardado | null;
}

export interface Seguimiento {
  codigo: string;
  cliente: string;
  estado: Estado;
  fechaCreacion: string;
  fechaPrometida: string;
  fechaEntrega: string | null;
  lugarEntrega: LugarEntrega;
  direccion: string | null;
  esProvincia: boolean;
  destino: string | null;
  agencia: string | null;
  detalle: string;
  actualizadoEn: string;
  historial: { estado: Estado; fecha: string }[];
  lineas: LineaSeguimiento[];
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Lo que devuelve la RPC, en el idioma de la pantalla. `null` si no se entiende. */
export function leerSeguimiento(json: unknown): Seguimiento | null {
  if (!json || typeof json !== "object") return null;
  const f = json as Record<string, unknown>;
  if (typeof f.codigo !== "string" || typeof f.estado !== "string") return null;

  const historial = Array.isArray(f.historial) ? (f.historial as Record<string, unknown>[]) : [];
  const lineas = Array.isArray(f.lineas) ? (f.lineas as Record<string, unknown>[]) : [];

  return {
    codigo: f.codigo,
    cliente: texto(f.cliente) ?? "",
    estado: f.estado as Estado,
    fechaCreacion: String(f.fecha_creacion ?? ""),
    fechaPrometida: String(f.fecha_prometida ?? ""),
    fechaEntrega: texto(f.fecha_entrega),
    lugarEntrega: f.lugar_entrega as LugarEntrega,
    direccion: texto(f.direccion_entrega),
    esProvincia: f.es_provincia === true,
    destino: [texto(f.provincia), texto(f.departamento)].filter(Boolean).join(", ") || null,
    agencia: texto(f.agencia),
    detalle: typeof f.detalle === "string" ? f.detalle : "",
    actualizadoEn: String(f.actualizado_en ?? ""),
    historial: historial
      .filter((h) => typeof h.estado === "string" && typeof h.fecha === "string")
      .map((h) => ({ estado: h.estado as Estado, fecha: h.fecha as string })),
    lineas: lineas.map((l) => ({
      posicion: Number(l.posicion),
      nombre: texto(l.nombre) ?? "",
      codigo: texto(l.codigo),
      descripcion: texto(l.descripcion),
      cantidad: Number(l.cantidad ?? 0),
      corte: l.tipo === "corte" ? leerCorte(l.corte) : null,
      terminado: l.tipo === "terminado" ? leerTerminado(l.terminado) : null,
    })),
  };
}

/* ── Los pasos ─────────────────────────────────────────────────────────────── */

export type EstadoPaso = "hecho" | "actual" | "pendiente";

export interface Paso {
  estado: Estado;
  titulo: string;
  descripcion: string;
  /** Cuándo llegó a este paso, si llegó. */
  fecha: string | null;
  situacion: EstadoPaso;
}

/**
 * El camino feliz de un pedido, en palabras del cliente. "En tránsito" solo
 * aparece si se lo lleva alguien (domicilio o agencia): quien recoge en tienda
 * pasa de listo a entregado.
 */
export function pasosDe(s: Pick<Seguimiento, "estado" | "historial" | "lugarEntrega">): Paso[] {
  const viaja = s.lugarEntrega === "domicilio" || s.lugarEntrega === "agencia";
  const camino: { estado: Estado; titulo: string; descripcion: string }[] = [
    { estado: "registrado", titulo: "Pedido recibido", descripcion: "Registramos tu pedido." },
    { estado: "en_proceso", titulo: "En fabricación", descripcion: "Nuestro taller está trabajando en tu pedido." },
    {
      estado: "listo",
      titulo: "Listo",
      descripcion: viaja ? "Tu pedido está listo para salir." : "Tu pedido está listo para recoger.",
    },
    ...(viaja
      ? [
          {
            estado: "en_transito" as Estado,
            titulo: "En camino",
            descripcion:
              s.lugarEntrega === "agencia" ? "Tu pedido va camino a la agencia." : "Tu pedido va camino a tu dirección.",
          },
        ]
      : []),
    { estado: "entregado", titulo: "Entregado", descripcion: "¡Gracias por tu compra!" },
  ];

  // Hasta dónde llegó: el último paso del camino que aparece en el historial o
  // es el estado de ahora. Un "observado" deja el avance donde estaba.
  const orden = camino.map((p) => p.estado);
  const alcanzados = new Set<Estado>([...s.historial.map((h) => h.estado), s.estado]);
  let actual = 0;
  orden.forEach((e, i) => {
    if (alcanzados.has(e)) actual = i;
  });
  if (orden.includes(s.estado)) actual = orden.indexOf(s.estado);

  const fechaDe = (e: Estado) => {
    const veces = s.historial.filter((h) => h.estado === e);
    return veces.length ? veces[veces.length - 1].fecha : null;
  };

  const terminado = s.estado === "entregado";
  return camino.map((p, i) => ({
    ...p,
    fecha: i <= actual ? fechaDe(p.estado) : null,
    situacion: i < actual || (terminado && i === actual) ? "hecho" : i === actual ? "actual" : "pendiente",
  }));
}

/** El aviso que acompaña a un estado fuera del camino. */
export function avisoDe(estado: Estado): { titulo: string; texto: string } | null {
  if (estado === "observado") {
    return {
      titulo: "Tu pedido tiene una observación",
      texto: "Necesitamos revisar un detalle. Nos pondremos en contacto contigo.",
    };
  }
  if (estado === "anulado") {
    return { titulo: "Pedido anulado", texto: "Este pedido fue anulado. Si tienes dudas, escríbenos." };
  }
  return null;
}
