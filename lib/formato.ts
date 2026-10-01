import { hoy } from "./fecha";
import {
  esTerminal,
  fechaCierreDe,
  saldoDe,
  sumarDias,
  unidadDe,
  venceCreditoEl,
  type Pedido,
} from "./dominio";

const soles = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
});

export const money = (n: number) => soles.format(n);

/** Sin céntimos: para cifras grandes de un vistazo (S/ 12,346). */
const solesEnteros = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  maximumFractionDigits: 0,
});

export const moneyEntero = (n: number) => solesEnteros.format(n);

/** Para ejes estrechos: S/ 12.3 K · S/ 1.2 M. */
const solesCompactos = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const moneyCompacto = (n: number) => solesCompactos.format(n);

const porcentajes = new Intl.NumberFormat("es-PE", { style: "percent", maximumFractionDigits: 0 });

/** 0.456 → "46%" */
export const porcentaje = (n: number) => porcentajes.format(n);

/** 2.5 → "2,5" · 12 → "12". Las planchas se cortan por mitades; las piezas no. */
const cantidades = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

export const numero = (n: number) => cantidades.format(n);

/** "2,5 planchas" · "12 unidades" */
export const cantidadTexto = (p: Pedido) => `${numero(p.cantidad)} ${unidadDe(p.tipos)}`;

/** Igual, abreviado para tablas y tarjetas: "2,5 pl." · "12 u." */
export const cantidadCorta = (p: Pedido) =>
  `${numero(p.cantidad)} ${unidadDe(p.tipos) === "planchas" ? "pl." : "u."}`;

/** 2026-08-30 → 30/08 */
export const diaMes = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

/** 2026-08-30 → 30/08/2026 */
export const fechaCompleta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * 2026-08-24 → "24 ago" (con año si no es el actual, o si se pide siempre).
 * A propósito distinto de `diaMes`: la fecha de registro no debe leerse como
 * la fecha prometida, que va en dd/mm.
 */
export const diaMesTexto = (iso: string, conAño = false) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  const año = !conAño && a === hoy().slice(0, 4) ? "" : ` ${a}`;
  return `${Number(d)} ${MESES[Number(m) - 1]}${año}`;
};

/**
 * Cuánto pasó desde un día, cada vez más grueso: "hoy" · "ayer" · "anteayer" ·
 * "hace 3 días" … "hace 6 días" · "hace 1 semana" … "hace 4 semanas" ·
 * "hace 1 mes" · "hace 2 meses" · "hace 1 año".
 */
export const haceCuanto = (iso: string) => {
  const dia = (s: string) => {
    const [a, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  const n = Math.round((dia(hoy()) - dia(iso)) / 86_400_000);
  if (n <= 0) return "hoy";
  if (n === 1) return "ayer";
  if (n === 2) return "anteayer";
  if (n < 7) return `hace ${n} días`;
  if (n < 30) {
    const semanas = Math.floor(n / 7);
    return semanas === 1 ? "hace 1 semana" : `hace ${semanas} semanas`;
  }
  if (n < 365) {
    const meses = Math.floor(n / 30);
    return meses === 1 ? "hace 1 mes" : `hace ${meses} meses`;
  }
  const años = Math.floor(n / 365);
  return años === 1 ? "hace 1 año" : `hace ${años} años`;
};

/** 2026-08-28T11:20:00 → 28/08/2026 11:20 */
export const fechaHora = (iso: string) => {
  const hora = iso.includes("T") ? iso.slice(11, 16) : "";
  return `${fechaCompleta(iso)}${hora ? ` ${hora}` : ""}`;
};

/**
 * Un pedido entregado o anulado hoy sigue en la vista de pedidos; a partir de
 * mañana solo se encuentra en el historial.
 */
export const cerradoHoy = (p: Pedido) => fechaCierreDe(p) === hoy();

/** El plazo de crédito ya pasó y el cliente todavía debe. */
export function creditoVencido(p: Pedido) {
  const vence = venceCreditoEl(p);
  return vence !== null && vence < hoy() && saldoDe(p) > 0;
}

export type Urgencia = "vencido" | "hoy" | "proximo" | "normal" | "cerrado";

export function urgenciaDe(p: Pedido): Urgencia {
  if (esTerminal(p.estado)) return "cerrado";
  if (p.fechaPrometida < hoy()) return "vencido";
  if (p.fechaPrometida === hoy()) return "hoy";
  const dias = Math.round(
    (new Date(p.fechaPrometida).getTime() - new Date(hoy()).getTime()) / 86_400_000,
  );
  return dias <= 2 ? "proximo" : "normal";
}

export const ETIQUETA_URGENCIA: Record<Urgencia, string> = {
  vencido: "Vencido",
  hoy: "Vence hoy",
  proximo: "Pronto",
  normal: "",
  cerrado: "",
};

export type Semaforo = "verde" | "naranja" | "rojo" | "cerrado";

/**
 * Semáforo de entrega del kanban. Verde mientras sobra tiempo, naranja el día
 * antes de la fecha prometida y rojo desde el mismo día en adelante: el día de
 * la entrega el trabajo ya tendría que estar hecho, no empezándose.
 *
 * Es más estricto que `urgenciaDe`, que colorea el texto de la fecha: aquí
 * "mañana" ya avisa. Un pedido cerrado no tiene semáforo; ya no corre.
 */
export function semaforoDe(p: Pedido): Semaforo {
  if (esTerminal(p.estado)) return "cerrado";
  if (p.fechaPrometida <= hoy()) return "rojo";
  return p.fechaPrometida === sumarDias(hoy(), 1) ? "naranja" : "verde";
}

/** El color nunca va solo: esto es lo que lee un lector de pantalla. */
export const ETIQUETA_SEMAFORO: Record<Semaforo, string> = {
  verde: "A tiempo",
  naranja: "Vence mañana",
  rojo: "Vence hoy o está vencido",
  cerrado: "Pedido cerrado",
};

/** Orden por defecto: lo abierto y urgente primero, lo cerrado al fondo. */
export function porUrgencia(a: Pedido, b: Pedido) {
  const ta = esTerminal(a.estado) ? 1 : 0;
  const tb = esTerminal(b.estado) ? 1 : 0;
  if (ta !== tb) return ta - tb;
  return ta
    ? b.fechaPrometida.localeCompare(a.fechaPrometida)
    : a.fechaPrometida.localeCompare(b.fechaPrometida);
}

/** En el historial manda la fecha de cierre, no la prometida: lo último arriba. */
export function porCierre(a: Pedido, b: Pedido) {
  return (fechaCierreDe(b) ?? "").localeCompare(fechaCierreDe(a) ?? "");
}
