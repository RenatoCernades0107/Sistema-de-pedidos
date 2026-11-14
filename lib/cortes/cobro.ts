/**
 * Qué pedazo de plancha se cobra por cada plancha cortada.
 *
 * La pregunta no es "¿qué porcentaje del área usan las piezas?" sino "¿cuál es
 * el pedazo más barato del que se pueden sacar todas?". El área es necesaria
 * para que quepan, pero no suficiente: dos piezas de 250×60 usan el 48 % de una
 * plancha de 305×205 y no entran en ninguna media.
 *
 * Por eso cada plancha poco usada se vuelve a empaquetar contra las fracciones
 * que vende el taller (cuarto, media), de la más barata a la más cara. La
 * primera en la que caben se cobra, se dibuja, y el resto de la plancha queda
 * entero como sobrante.
 */

import type { ConfigCortes, Fraccion } from "./config";
import {
  EPS,
  empaquetar,
  entraSola,
  piezasDe,
  type Panel,
  type Pieza,
  type PlanchaCortada,
} from "./optimizador";

export interface Cobro {
  /** "1/16", "1/8", "1/4", "1/2", "3/4" o "1" para la plancha completa. */
  nombre: string;
  factor: number;
  /** El pedazo cobrado, anclado en la esquina (0,0) de la plancha. */
  ancho: number;
  alto: number;
  monto: number;
  /** Por qué se cobra completa aunque el uso sea bajo. */
  nota: string | null;
}

export interface PlanchaCobrada extends PlanchaCortada {
  cobro: Cobro;
}

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo que queda de la plancha fuera del pedazo cobrado, en orden de corte. */
function sobrantes(W: number, H: number, w: number, h: number): Panel[] {
  const salida: Panel[] = [];
  // Primero se separa la media: franja derecha, alto completo.
  if (W - w > EPS) salida.push({ x1: w, y1: 0, x2: W, y2: H, libre: true, sobrante: true });
  // Después el cuarto: lo que queda debajo.
  if (H - h > EPS) salida.push({ x1: 0, y1: h, x2: w, y2: H, libre: true, sobrante: true });
  return salida;
}

export interface OpcionesCobro {
  precioPlancha: number;
  recargoPct: number;
  fracciones: Fraccion[];
  rotar: boolean;
  kerf: number;
  margen: number;
}

/**
 * Decide el cobro de una plancha y, si es una fracción, reacomoda sus piezas
 * dentro de ella. `originales` son las piezas pedidas, por id.
 */
export function cobrarPlancha(
  plancha: PlanchaCortada,
  originales: Map<string, Pieza>,
  o: OpcionesCobro,
): PlanchaCobrada {
  const { ancho: W, alto: H } = plancha;
  const completa: Cobro = {
    nombre: "1",
    factor: 1,
    ancho: W,
    alto: H,
    monto: redondear2(o.precioPlancha),
    nota: null,
  };
  // Lo que sale de un sobrante del almacén no se cobra por fracción.
  if (plancha.origen.tipo !== "plancha") return { ...plancha, cobro: completa };

  const piezas = piezasDe(plancha, originales);
  const areaPiezas = piezas.reduce((s, p) => s + p.ancho * p.alto, 0);
  let cabiaPorArea: string | null = null;

  for (const f of o.fracciones) {
    // Filtro rápido: si no cabe ni el área, no hay nada que acomodar.
    if (areaPiezas > f.factor * W * H + EPS) continue;
    cabiaPorArea ??= f.nombre;

    for (const [fw, fh] of f.formas) {
      const w = fw * W;
      const h = fh * H;
      // El corte que separa el pedazo también se come su kerf, y por dentro de
      // la plancha no hay borde que descartar.
      const interiorW = W - w > EPS;
      const interiorH = H - h > EPS;
      const anchoUtil = w - (interiorW ? o.kerf - o.margen : 0);
      const altoUtil = h - (interiorH ? o.kerf - o.margen : 0);
      if (piezas.some((p) => !entraSola(p, anchoUtil - 2 * o.margen, altoUtil - 2 * o.margen, o.rotar))) {
        continue;
      }

      const r = empaquetar(anchoUtil, altoUtil, piezas, { rotar: o.rotar, kerf: o.kerf, margen: o.margen });
      if (r.planchas.length !== 1 || r.noCaben.length > 0) continue;

      const dentro = r.planchas[0];
      return {
        ...plancha,
        paneles: [...dentro.paneles, ...sobrantes(W, H, w, h)],
        areaUsada: dentro.areaUsada,
        usoPct: (dentro.areaUsada / (W * H)) * 100,
        cobro: {
          nombre: f.nombre,
          factor: f.factor,
          ancho: w,
          alto: h,
          monto: redondear2(o.precioPlancha * f.factor * (1 + o.recargoPct / 100)),
          nota: null,
        },
      };
    }
  }

  return {
    ...plancha,
    cobro: {
      ...completa,
      // Sin esto quien cotiza ve 48 % de uso y espera media plancha.
      nota: cabiaPorArea
        ? `${Math.round(plancha.usoPct)} % de uso, pero las piezas no caben en ${cabiaPorArea} plancha`
        : null,
    },
  };
}

export const opcionesDeCobro = (
  config: ConfigCortes,
  precioPlancha: number,
  rotar: boolean,
  kerf: number,
): OpcionesCobro => ({
  precioPlancha,
  recargoPct: config.cobro.recargoPct,
  fracciones: config.cobro.fracciones,
  rotar,
  kerf,
  margen: config.corte.margen,
});
