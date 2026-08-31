/**
 * "Hoy" según la empresa, no según el servidor.
 *
 * Un pedido entregado a las 8 de la noche en Lima ya es del día siguiente en
 * UTC: con `toISOString()` desaparecería de la lista cinco horas antes de
 * tiempo. Vercel corre en UTC y el navegador en la zona de quien mire, así que
 * la única forma de que servidor y cliente pinten lo mismo es fijar la zona.
 */
const enLima = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en Lima, en formato ISO corto: 2026-08-31. */
export const hoy = () => enLima.format(new Date());

const conHora = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Un `timestamptz` de Postgres llega en UTC. Leerlo tal cual corre las horas
 * cinco puestos: un cambio de estado de las 16:05 aparecería como las 21:05.
 *
 * Devuelve `2026-08-19T16:05`, que es lo que la UI sabe pintar.
 */
export function momentoEnLima(ts: string | null | undefined): string {
  if (!ts) return "";
  const partes = conHora.formatToParts(new Date(ts));
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}T${parte("hour")}:${parte("minute")}`;
}

/** Solo el día, ya corrido a Lima: 2026-08-19. */
export const diaEnLima = (ts: string | null | undefined) => momentoEnLima(ts).slice(0, 10);
