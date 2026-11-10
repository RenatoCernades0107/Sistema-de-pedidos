/**
 * El cálculo completo de un corte: de "10 piezas de 60×80 en acrílico de 3 mm"
 * a cuántas planchas hacen falta, de qué formato conviene, y cuánto cuesta.
 *
 * Puro, como el optimizador: recibe el formato con su precio y la configuración,
 * y devuelve números. Lo corren el navegador (para enseñar el resultado mientras
 * se escribe) y el servidor (que lo recalcula antes de guardar: el precio no es
 * algo que deba llegar del navegador).
 */

import type { ConfigCortes } from "./config";
import { cobrarPlancha, opcionesDeCobro, type PlanchaCobrada } from "./cobro";
import { tiempoLaser, type PiezaPedida } from "./laser";
import { mensajeSinPrecioManual, precioManual } from "./manual";
import { empaquetar, type Pieza, type ResultadoCorte } from "./optimizador";

export type { PiezaPedida } from "./laser";

export type Modalidad = "laser" | "manual";

export const MODALIDADES: Record<Modalidad, string> = {
  laser: "Corte láser",
  manual: "Corte manual",
};

/** Un formato de plancha con lo que hace falta para calcular sobre él. */
export interface FormatoCorte {
  /** La referencia interna de Odoo. */
  codigo: string;
  /** cm */
  ancho: number;
  /** cm */
  alto: number;
  /** Precio de la plancha entera en Odoo. */
  precio: number;
}

export interface EntradaCorte {
  piezas: PiezaPedida[];
  espesorMm: number;
  modalidad: Modalidad;
  /** `false` si el material tiene veta o dibujo y las piezas no se pueden girar. */
  rotable: boolean;
}

export interface LineaDesglose {
  etiqueta: string;
  monto: number;
  esTotal?: boolean;
}

export interface CalculoCorte {
  formato: FormatoCorte;
  planchas: PlanchaCobrada[];
  /** Las piezas que no entran en este formato, agrupadas como se pidieron. */
  noCaben: PiezaPedida[];
  /** Cuántas piezas se cortan en total. */
  piezas: number;
  /** Lo que se cobra por el material. */
  material: number;
  /** Lo que se cobra por cortar. */
  servicio: number;
  total: number;
  /** Del área de las planchas abiertas, la que no acaba en una pieza. */
  desperdicioPct: number;
  /** Solo con láser. */
  minutosLaser: number | null;
  desglose: LineaDesglose[];
  /** Si el cálculo no se puede usar tal cual, por qué. */
  problema: string | null;
}

/** Tope de piezas por corte: de ahí para arriba ya no es un pedido de mostrador. */
export const MAX_PIEZAS = 2000;

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const numero = (n: number) => String(+n.toFixed(2));
const soles = (n: number) => `S/ ${n.toFixed(2)}`;

/** `f2#3`: la tercera pieza de la segunda fila del pedido. */
const idDe = (fila: number, n: number) => `f${fila + 1}#${n + 1}`;

/** La fila del pedido (desde 1) a la que pertenece una pieza del resultado. */
export const filaDe = (piezaId: string): number => Number(/^f(\d+)#/.exec(piezaId)?.[1] ?? 0);

export function contarPiezas(piezas: PiezaPedida[]): number {
  return piezas.reduce((s, p) => s + (p.cantidad > 0 ? Math.floor(p.cantidad) : 0), 0);
}

function expandir(piezas: PiezaPedida[], rotable: boolean): Pieza[] {
  const salida: Pieza[] = [];
  piezas.forEach((p, fila) => {
    if (!(p.ancho > 0) || !(p.alto > 0)) return;
    for (let n = 0; n < Math.floor(p.cantidad); n++) {
      salida.push({ id: idDe(fila, n), ancho: p.ancho, alto: p.alto, rotable });
    }
  });
  return salida;
}

/** Lo que no cabe, otra vez como filas "ancho × alto × cantidad". */
function agrupar(piezas: Pieza[]): PiezaPedida[] {
  const filas = new Map<string, PiezaPedida>();
  for (const p of piezas) {
    const clave = `${p.ancho}x${p.alto}`;
    const fila = filas.get(clave);
    if (fila) fila.cantidad += 1;
    else filas.set(clave, { ancho: p.ancho, alto: p.alto, cantidad: 1 });
  }
  return [...filas.values()];
}

export const kerfDe = (config: ConfigCortes, modalidad: Modalidad) =>
  modalidad === "laser" ? config.corte.kerfLaser : config.corte.kerfManual;

/** El cálculo sobre un formato concreto. */
export function calcularCorte(
  entrada: EntradaCorte,
  formato: FormatoCorte,
  config: ConfigCortes,
): CalculoCorte {
  const total = contarPiezas(entrada.piezas);
  const vacio = (problema: string): CalculoCorte => ({
    formato,
    planchas: [],
    noCaben: [],
    piezas: total,
    material: 0,
    servicio: 0,
    total: 0,
    desperdicioPct: 0,
    minutosLaser: null,
    desglose: [],
    problema,
  });

  if (total === 0) return vacio("Agrega al menos una pieza con sus medidas.");
  if (total > MAX_PIEZAS) return vacio(`Son demasiadas piezas para un solo corte (máximo ${MAX_PIEZAS}).`);

  const piezas = expandir(entrada.piezas, entrada.rotable);
  const originales = new Map(piezas.map((p) => [p.id, p]));
  const kerf = kerfDe(config, entrada.modalidad);
  const cobro = opcionesDeCobro(config, formato.precio, entrada.rotable, kerf);

  const cobrar = (r: ResultadoCorte) => r.planchas.map((p) => cobrarPlancha(p, originales, cobro));
  const memoria = new Map<ResultadoCorte, PlanchaCobrada[]>();
  const cobradas = (r: ResultadoCorte) => {
    let c = memoria.get(r);
    if (!c) memoria.set(r, (c = cobrar(r)));
    return c;
  };

  // Entre acomodos con las mismas planchas, el que menos cobra: eso concentra
  // las piezas y libera la última plancha.
  const corte = empaquetar(formato.ancho, formato.alto, piezas, {
    rotar: entrada.rotable,
    kerf,
    margen: config.corte.margen,
    costo: (r) => cobradas(r).reduce((s, p) => s + p.cobro.monto, 0),
  });
  const planchas = cobradas(corte);

  const material = redondear2(planchas.reduce((s, p) => s + p.cobro.monto, 0));
  const areaPlanchas = planchas.length * formato.ancho * formato.alto;
  const areaUsada = planchas.reduce((s, p) => s + p.areaUsada, 0);

  const desglose: LineaDesglose[] = planchas.map((p, i) => {
    const medida = `${numero(formato.ancho)}×${numero(formato.alto)}`;
    if (p.cobro.factor < 1) {
      return {
        etiqueta:
          `Plancha ${i + 1}: las piezas caben en ${p.cobro.nombre} ` +
          `(${numero(p.cobro.ancho)}×${numero(p.cobro.alto)}) → ${soles(formato.precio)} × ${p.cobro.nombre}` +
          (config.cobro.recargoPct ? ` + ${numero(config.cobro.recargoPct)} %` : ""),
        monto: p.cobro.monto,
      };
    }
    return {
      etiqueta: `Plancha ${i + 1}: ${p.cobro.nota ?? `completa (${medida})`}`,
      monto: p.cobro.monto,
    };
  });

  let servicioBruto = 0;
  let minutosLaser: number | null = null;
  let problema: string | null = null;

  if (entrada.modalidad === "laser") {
    const t = tiempoLaser(entrada.piezas, entrada.espesorMm, config.laser);
    minutosLaser = t.segundos / 60;
    servicioBruto = t.costo * (1 + config.laser.igvPct / 100);
  } else {
    const porPieza = precioManual(config.manual.precios, entrada.espesorMm);
    if (porPieza === null) problema = mensajeSinPrecioManual(entrada.espesorMm);
    else servicioBruto = total * porPieza;
  }

  // El redondeo va sobre el total; lo absorbe el servicio, que es la línea que
  // no tiene un precio de lista detrás.
  const suma = material + servicioBruto;
  const totalFinal = config.cobro.redondearAlSol ? Math.ceil(suma - 1e-9) : redondear2(suma);
  const servicio = redondear2(totalFinal - material);

  desglose.push({
    etiqueta:
      entrada.modalidad === "laser"
        ? `Corte láser: ${total} ${total === 1 ? "pieza" : "piezas"}, ${numero(minutosLaser ?? 0)} min`
        : `Corte manual: ${total} ${total === 1 ? "pieza" : "piezas"} de ${numero(entrada.espesorMm)} mm`,
    monto: servicio,
  });
  desglose.push({ etiqueta: "Total", monto: redondear2(totalFinal), esTotal: true });

  const noCaben = agrupar(corte.noCaben);
  if (noCaben.length > 0) {
    const cuantas = noCaben.reduce((s, p) => s + p.cantidad, 0);
    problema =
      `${cuantas} ${cuantas === 1 ? "pieza no cabe" : "piezas no caben"} en una plancha de ` +
      `${numero(formato.ancho)}×${numero(formato.alto)} cm.`;
  }

  return {
    formato,
    planchas,
    noCaben,
    piezas: total,
    material,
    servicio,
    total: redondear2(totalFinal),
    desperdicioPct: areaPlanchas > 0 ? (1 - areaUsada / areaPlanchas) * 100 : 0,
    minutosLaser,
    desglose,
    problema,
  };
}

/**
 * El mismo corte sobre cada formato disponible, del más conveniente al menos:
 * primero los que sirven, y entre ellos el más barato; a igual precio, el que
 * menos desperdicia y, a igual desperdicio, la plancha más chica.
 */
export function compararFormatos(
  entrada: EntradaCorte,
  formatos: FormatoCorte[],
  config: ConfigCortes,
): CalculoCorte[] {
  return formatos
    .map((f) => calcularCorte(entrada, f, config))
    .sort(
      (a, b) =>
        Number(!!a.problema) - Number(!!b.problema) ||
        a.total - b.total ||
        a.desperdicioPct - b.desperdicioPct ||
        a.formato.ancho * a.formato.alto - b.formato.ancho * b.formato.alto ||
        a.formato.codigo.localeCompare(b.formato.codigo),
    );
}
