/**
 * El cálculo completo de un corte: de "10 piezas de 60×80 en acrílico de 3 mm"
 * a cuántas planchas hacen falta, de qué formato conviene, y cuánto cuesta.
 *
 * Puro, como el optimizador: recibe el formato con su precio y la configuración,
 * y devuelve números. Lo corren el navegador (para enseñar el resultado mientras
 * se escribe) y el servidor (que lo recalcula antes de guardar: el precio no es
 * algo que deba llegar del navegador).
 */

import type { ConfigCortes, PoliticaSugerencia } from "./config";
import { cobrarPlancha, opcionesDeCobro, type PlanchaCobrada } from "./cobro";
import { tiempoLaser, type PiezaPedida } from "./laser";
import { mensajeSinPrecioManual, tarifaManual } from "./manual";
import { cortesManuales, largoTotal } from "./metros";
import { empaquetar, entraSola, piezasDe, type Contenedor, type Origen, type Pieza, type PlanchaCortada, type ResultadoCorte } from "./optimizador";

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
  /** El formato principal: el de más planchas. */
  formato: FormatoCorte;
  /**
   * Los formatos que corta, el principal primero. Uno solo, salvo cuando el
   * corte mezcla formatos (`calcularMezcla`): entonces cada plancha nueva dice
   * el suyo en `origen.formato`.
   */
  formatos: FormatoCorte[];
  /**
   * Solo en una mezcla: el formato del que partió (`calcularMezcla`). El
   * servidor la rehace desde ahí para llegar al mismo acomodo.
   */
  mezclaDesde?: string;
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
  /** Solo con corte manual: los metros lineales de cutter. */
  metrosManual: number | null;
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

/**
 * El cálculo sobre un formato concreto.
 *
 * `sobrantes` son piezas del almacén del mismo material (piloto de sobrantes),
 * en el orden en que conviene usarlas. Cambian el acomodo —qué se corta de
 * dónde— pero no el precio: un corte cuesta lo mismo salga de donde salga, como
 * si fueran planchas nuevas del formato elegido.
 */
export function calcularCorte(
  entrada: EntradaCorte,
  formato: FormatoCorte,
  config: ConfigCortes,
  sobrantes: Contenedor[] = [],
): CalculoCorte {
  const total = contarPiezas(entrada.piezas);
  const invalida = entradaInvalida(total);
  if (invalida) return calculoVacio(formato, total, invalida);

  const piezas = expandir(entrada.piezas, entrada.rotable);
  const originales = new Map(piezas.map((p) => [p.id, p]));
  const kerf = kerfDe(config, entrada.modalidad);
  const cobradas = cobrador(entrada, config, [formato], originales);

  // Entre acomodos con las mismas planchas, el que menos cobra: eso concentra
  // las piezas y libera la última plancha.
  const corte = empaquetadoDe(entrada, formato, config, () =>
    empaquetar(formato.ancho, formato.alto, piezas, {
      rotar: entrada.rotable,
      kerf,
      margen: config.corte.margen,
      costo: (r) => cobradas(r).reduce((s, p) => s + p.cobro.monto, 0),
    }),
  );
  const precio = cobradas(corte);
  let planchas = precio;
  if (sobrantes.length) {
    /* El acomodo físico, con los sobrantes primero. Si no mejora nada (no se usó
       ninguno) o dejara piezas fuera, vale el de planchas nuevas. */
    const fisico = empaquetar(formato.ancho, formato.alto, piezas, {
      rotar: entrada.rotable,
      kerf,
      margen: config.corte.margen,
      previos: sobrantes,
      costo: (r) => cobradas(r).reduce((s, p) => s + (p.origen.tipo === "plancha" ? p.cobro.monto : 0), 0),
    });
    if (fisico.noCaben.length === 0 && fisico.planchas.some((p) => p.origen.tipo === "sobrante")) {
      planchas = cobradas(fisico);
    }
  }

  return armarCalculo(entrada, config, [formato], precio, planchas, corte.noCaben);
}

/**
 * El empaquetado en planchas nuevas de un formato, guardado por entrada y
 * configuración: la pantalla calcula cada formato solo, con sobrantes y con
 * mezclas sobre la misma entrada, y es la parte cara. Las piezas salen siempre
 * igual de la entrada, así que el resultado vale mientras ella no cambie (y un
 * objeto de entrada nuevo es otra entrada).
 */
const empaquetados = new WeakMap<EntradaCorte, WeakMap<ConfigCortes, Map<string, ResultadoCorte>>>();
function empaquetadoDe(
  entrada: EntradaCorte,
  formato: FormatoCorte,
  config: ConfigCortes,
  hacer: () => ResultadoCorte,
): ResultadoCorte {
  let porConfig = empaquetados.get(entrada);
  if (!porConfig) empaquetados.set(entrada, (porConfig = new WeakMap()));
  let porFormato = porConfig.get(config);
  if (!porFormato) porConfig.set(config, (porFormato = new Map()));
  const clave = `${formato.codigo}|${formato.ancho}|${formato.alto}|${formato.precio}`;
  let r = porFormato.get(clave);
  if (!r) porFormato.set(clave, (r = hacer()));
  return r;
}

/** Por qué no se puede calcular, o `null` si se puede. */
function entradaInvalida(total: number): string | null {
  if (total === 0) return "Agrega al menos una pieza con sus medidas.";
  if (total > MAX_PIEZAS) return `Son demasiadas piezas para un solo corte (máximo ${MAX_PIEZAS}).`;
  return null;
}

function calculoVacio(formato: FormatoCorte, piezas: number, problema: string): CalculoCorte {
  return {
    formato,
    formatos: [formato],
    planchas: [],
    noCaben: [],
    piezas,
    material: 0,
    servicio: 0,
    total: 0,
    desperdicioPct: 0,
    minutosLaser: null,
    metrosManual: null,
    desglose: [],
    problema,
  };
}

/** El formato de una plancha de un cálculo: el suyo si lo dice, si no, el primero. */
export function formatoDe<F extends { codigo: string }>(formatos: F[], p: { origen: Origen }): F {
  const codigo = p.origen.tipo === "plancha" ? p.origen.formato : undefined;
  return (codigo && formatos.find((f) => f.codigo === codigo)) || formatos[0];
}

/**
 * Cobra las planchas de un resultado, cada una al precio de su formato, con
 * memoria: el empaquetado pregunta por el mismo resultado varias veces.
 */
function cobrador(entrada: EntradaCorte, config: ConfigCortes, formatos: FormatoCorte[], originales: Map<string, Pieza>) {
  const kerf = kerfDe(config, entrada.modalidad);
  const opciones = new Map(formatos.map((f) => [f.codigo, opcionesDeCobro(config, f.precio, entrada.rotable, kerf)]));
  // Por plancha y no por resultado: una mezcla prueba muchos acomodos que
  // comparten casi todas sus planchas, y cobrar una puede reacomodarla entera.
  const memoria = new WeakMap<PlanchaCortada, PlanchaCobrada>();
  const cobrar = (p: PlanchaCortada) => {
    let c = memoria.get(p);
    if (!c) memoria.set(p, (c = cobrarPlancha(p, originales, opciones.get(formatoDe(formatos, p).codigo)!)));
    return c;
  };
  return (r: ResultadoCorte) => r.planchas.map(cobrar);
}

/**
 * Del acomodo al cálculo: material, desglose, servicio y total. `precio` son las
 * planchas con que se cobra (siempre nuevas) y `planchas`, las que de verdad se
 * cortan (con los sobrantes del almacén, si se usan). `formatos[0]` es el principal.
 */
function armarCalculo(
  entrada: EntradaCorte,
  config: ConfigCortes,
  formatos: FormatoCorte[],
  precio: PlanchaCobrada[],
  fisicas: PlanchaCobrada[],
  fuera: Pieza[],
): CalculoCorte {
  const formato = formatos[0];
  const total = contarPiezas(entrada.piezas);
  const kerf = kerfDe(config, entrada.modalidad);
  const mezcla = formatos.length > 1;
  let planchas = fisicas;

  const material = redondear2(precio.reduce((s, p) => s + p.cobro.monto, 0));
  const areaPlanchas = precio.reduce((s, p) => s + p.ancho * p.alto, 0);
  const areaUsada = precio.reduce((s, p) => s + p.areaUsada, 0);

  const desglose: LineaDesglose[] = precio.map((p, i) => {
    const f = formatoDe(formatos, p);
    const medida = `${numero(p.ancho)}×${numero(p.alto)}`;
    // Con varios formatos, cada plancha dice de cuál es.
    const de = mezcla ? ` de ${medida} (${f.codigo})` : "";
    if (p.cobro.factor < 1) {
      return {
        etiqueta:
          `Plancha ${i + 1}${de}: las piezas caben en ${p.cobro.nombre} ` +
          `(${numero(p.cobro.ancho)}×${numero(p.cobro.alto)}) → ${soles(f.precio)} × ${p.cobro.nombre}` +
          (p.cobro.recargoPct ? ` + ${numero(p.cobro.recargoPct)} %` : ""),
        monto: p.cobro.monto,
      };
    }
    return {
      etiqueta: `Plancha ${i + 1}${de}: ${p.cobro.nota ?? (mezcla ? "completa" : `completa (${medida})`)}`,
      monto: p.cobro.monto,
    };
  });

  let servicioBruto = 0;
  let minutosLaser: number | null = null;
  let metrosManual: number | null = null;
  let tarifa: number | null = null;
  let problema: string | null = null;

  if (entrada.modalidad === "laser") {
    const t = tiempoLaser(entrada.piezas, entrada.espesorMm, config.laser);
    minutosLaser = t.segundos / 60;
    servicioBruto = t.costo * (1 + config.laser.igvPct / 100);
  } else {
    // Sobre el acomodo que de verdad se corta, sobrantes del almacén incluidos.
    // Los cortes quedan en cada plancha: el plano dibuja los mismos que se cobran.
    planchas = planchas.map((p) => ({ ...p, cortes: cortesManuales(p, { kerf, margen: config.corte.margen }) }));
    metrosManual = planchas.reduce((s, p) => s + largoTotal(p.cortes ?? []), 0) / 100;
    tarifa = tarifaManual(config.manual.tarifas, entrada.espesorMm);
    if (tarifa === null) problema = mensajeSinPrecioManual(entrada.espesorMm);
    else servicioBruto = metrosManual * tarifa;
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
        : `Corte manual: ${numero(metrosManual ?? 0)} m lineales` +
          (tarifa === null ? "" : ` × ${soles(tarifa)}/m`) +
          ` (${numero(entrada.espesorMm)} mm)`,
    monto: servicio,
  });
  desglose.push({ etiqueta: "Total", monto: redondear2(totalFinal), esTotal: true });

  const noCaben = agrupar(fuera);
  if (noCaben.length > 0) {
    const cuantas = noCaben.reduce((s, p) => s + p.cantidad, 0);
    problema =
      `${cuantas} ${cuantas === 1 ? "pieza no cabe" : "piezas no caben"} en una plancha de ` +
      `${numero(formato.ancho)}×${numero(formato.alto)} cm.`;
  }

  return {
    formato,
    formatos,
    planchas,
    noCaben,
    piezas: total,
    material,
    servicio,
    total: redondear2(totalFinal),
    desperdicioPct: areaPlanchas > 0 ? (1 - areaUsada / areaPlanchas) * 100 : 0,
    minutosLaser,
    metrosManual,
    desglose,
    problema,
  };
}

/* ── Varios formatos en un corte ───────────────────────────────────────────── */

/** Lo que se compara entre dos acomodos al decidir si una mezcla conviene. */
interface Puntaje {
  monto: number;
  merma: number;
}

/** Si `a` es mejor que `b` según la política de sugerencia. */
function mejora(a: Puntaje, b: Puntaje, politica: PoliticaSugerencia): boolean {
  const menor = (x: number, y: number) => x < y - 1e-6;
  const igual = (x: number, y: number) => Math.abs(x - y) <= 1e-6;
  if (politica === "precio") return menor(a.monto, b.monto) || (igual(a.monto, b.monto) && menor(a.merma, b.merma));
  if (politica === "merma") return menor(a.merma, b.merma) || (igual(a.merma, b.merma) && menor(a.monto, b.monto));
  // "promedio" y "tamano": solo si no empeora ninguna de las dos.
  return !menor(b.monto, a.monto) && !menor(b.merma, a.merma) && (menor(a.monto, b.monto) || menor(a.merma, b.merma));
}

/**
 * El corte sobre `base` mejorado con otros formatos del mismo material: las
 * planchas menos usadas se rehacen en el formato que más convenga, mientras
 * mejore según la política.
 * Por ejemplo, 4 planchas de 122×244 donde la última lleva poco quedan en 3 de
 * 122×244 y 1 de 122×183.
 *
 * Determinista: el servidor la repite con las mismas entradas y llega a lo mismo.
 * Devuelve `null` si no hay mezcla que ofrecer (no mejora, o acaba en un solo
 * formato, que ya se ofrece solo).
 */
export function calcularMezcla(
  entrada: EntradaCorte,
  base: FormatoCorte,
  alternativas: FormatoCorte[],
  config: ConfigCortes,
  politica: PoliticaSugerencia = config.sugerencia.politica,
): CalculoCorte | null {
  const formatos = [base, ...alternativas.filter((f) => f.codigo !== base.codigo)];
  if (formatos.length < 2) return null;
  const total = contarPiezas(entrada.piezas);
  if (entradaInvalida(total)) return null;

  const piezas = expandir(entrada.piezas, entrada.rotable);
  const originales = new Map(piezas.map((p) => [p.id, p]));
  const kerf = kerfDe(config, entrada.modalidad);
  const margen = config.corte.margen;
  const cobradas = cobrador(entrada, config, formatos, originales);
  const montoDe = (r: ResultadoCorte) => cobradas(r).reduce((s, p) => s + p.cobro.monto, 0);
  const deFormato = (r: ResultadoCorte, f: FormatoCorte): ResultadoCorte => ({
    ...r,
    planchas: r.planchas.map((p) => ({ ...p, origen: { tipo: "plancha", formato: f.codigo } })),
  });
  // Sin desempate por costo (que reacomoda cada plancha contra las
  // fracciones): dentro del bucle se prueban muchos acomodos.
  const empaquetarEn = (f: FormatoCorte, ps: Pieza[]) =>
    deFormato(empaquetar(f.ancho, f.alto, ps, { rotar: entrada.rotable, kerf, margen }), f);
  const puntaje = (r: ResultadoCorte): Puntaje => {
    const c = cobradas(r);
    const area = c.reduce((s, p) => s + p.ancho * p.alto, 0);
    const usada = c.reduce((s, p) => s + p.areaUsada, 0);
    return { monto: c.reduce((s, p) => s + p.cobro.monto, 0), merma: area > 0 ? 1 - usada / area : 0 };
  };

  // El mismo empaquetado de partida que `calcularCorte` (y el mismo guardado).
  const inicial = deFormato(
    empaquetadoDe(entrada, base, config, () =>
      empaquetar(base.ancho, base.alto, piezas, {
        rotar: entrada.rotable,
        kerf,
        margen,
        costo: (r) => montoDe(r),
      }),
    ),
    base,
  );
  if (inicial.noCaben.length > 0) return null;
  let actual = inicial;
  let puntos = puntaje(actual);

  // Cada vuelta acepta solo lo que mejora, así que termina; el tope es por si acaso.
  for (let vuelta = 0; vuelta < 40; vuelta++) {
    // Las menos usadas primero; a igual uso, la última abierta.
    const orden = actual.planchas
      .map((p, i) => ({ p, i }))
      .sort((a, b) => a.p.usoPct - b.p.usoPct || b.i - a.i);
    let mejor: { r: ResultadoCorte; puntos: Puntaje } | null = null;
    const considerar = (r: ResultadoCorte) => {
      if (r.noCaben.length > 0) return;
      const pt = puntaje(r);
      if (mejora(pt, mejor ? mejor.puntos : puntos, politica)) mejor = { r, puntos: pt };
    };
    /** Rehace las planchas `victimas` en planchas nuevas de `en` (o de cada formato). */
    const rehacer = (victimas: Set<number>, en: FormatoCorte[] = formatos) => {
      if (victimas.size === 0) return;
      const resto = actual.planchas.filter((_, i) => !victimas.has(i));
      const sueltas = actual.planchas.filter((_, i) => victimas.has(i)).flatMap((p) => piezasDe(p, originales));
      // Cobradas cada una con las fracciones de su formato.
      for (const f of en) {
        const r = empaquetarEn(f, sueltas);
        considerar({ planchas: [...resto, ...r.planchas], noCaben: r.noCaben });
      }
    };

    // Las k menos usadas, de a pocas.
    for (const k of [1, 2, 4, 8, 16]) {
      if (orden.length < k) break;
      rehacer(new Set(orden.slice(0, k).map((x) => x.i)));
    }
    // Y de una vez, todas las planchas de otro formato cuyas piezas entran en
    // este: con muchas planchas iguales, moverlas de a pocas no llega nunca.
    for (const f of formatos) {
      const entran = new Set<number>();
      actual.planchas.forEach((p, i) => {
        if (formatoDe(formatos, p).codigo === f.codigo) return;
        const caben = piezasDe(p, originales).every((x) =>
          entraSola(x, f.ancho - 2 * margen, f.alto - 2 * margen, entrada.rotable),
        );
        if (caben) entran.add(i);
      });
      rehacer(entran, [f]);
    }

    if (!mejor) break;
    ({ r: actual, puntos } = mejor);
  }

  if (actual === inicial) return null;
  const cuenta = new Map<string, number>();
  for (const p of actual.planchas) {
    const f = formatoDe(formatos, p);
    cuenta.set(f.codigo, (cuenta.get(f.codigo) ?? 0) + 1);
  }
  if (cuenta.size < 2) return null;

  // El principal es el de más planchas; a igualdad, el de la base.
  const usados = formatos
    .filter((f) => cuenta.has(f.codigo))
    .sort((a, b) => cuenta.get(b.codigo)! - cuenta.get(a.codigo)!);
  const precio = cobradas(actual);
  return { ...armarCalculo(entrada, config, usados, precio, precio, []), mezclaDesde: base.codigo };
}

/** Si un cálculo corta planchas de más de un formato. */
export const esMezcla = (c: Pick<CalculoCorte, "formatos">) => c.formatos.length > 1;

/** Cómo se ordenan los formatos: ver `PoliticaSugerencia` en `config.ts`. */
export type CriterioFormato = PoliticaSugerencia;

/** El área de la plancha del cálculo; en una mezcla, la del formato más grande que abre. */
const areaDe = (c: CalculoCorte) => Math.max(...c.formatos.map((f) => f.ancho * f.alto));

/**
 * El mismo corte sobre cada formato disponible, del más conveniente al menos.
 * Siempre van primero los que sirven. Entre ellos, según el criterio (por
 * defecto, la política de sugerencia de Configuración):
 *  - "precio": el más barato; a igual precio, el que menos
 *    desperdicia y, a igual desperdicio, la plancha más chica.
 *  - "merma": el que menos desperdicia; a igual merma, el más barato.
 *  - "promedio": el de mejor promedio entre su puesto por precio y su puesto por
 *    merma; a igualdad, el más barato.
 *  - "tamano": la plancha más chica, aunque desperdicie más o cueste más —los
 *    formatos grandes se guardan para los pedidos de medidas grandes—; a igual
 *    tamaño, el más barato.
 */
export function compararFormatos(
  entrada: EntradaCorte,
  formatos: FormatoCorte[],
  config: ConfigCortes,
  sobrantes: Contenedor[] = [],
  criterio: CriterioFormato = config.sugerencia.politica,
  /**
   * Ofrecer también cortes que mezclan formatos. Una mezcla sale solo de
   * planchas nuevas: con sobrantes en el almacén compite con los que los usan.
   */
  mezclar = false,
): CalculoCorte[] {
  const calculos = formatos.map((f) => calcularCorte(entrada, f, config, sobrantes));
  if (mezclar) {
    const vistas = new Set<string>();
    // Desde los dos mejores de un solo formato: desde los demás suele llegarse a
    // la misma mezcla, y cada una cuesta lo que varios cálculos.
    const bases = ordenarCalculos(calculos.filter((c) => !c.problema), criterio).slice(0, 2);
    for (const c of bases) {
      const m = calcularMezcla(entrada, c.formato, formatos, config, criterio);
      // Dos bases pueden llegar a la misma mezcla: se ofrece una vez.
      const firma = m && `${m.planchas.map((p) => formatoDe(m.formatos, p).codigo).sort().join(",")}|${m.total}`;
      if (m && !m.problema && !vistas.has(firma!)) {
        vistas.add(firma!);
        calculos.push(m);
      }
    }
  }
  return ordenarCalculos(calculos, criterio);
}

/** El puesto (0 = mejor) de cada cálculo según un valor; los empatados comparten puesto. */
function puestos(cs: CalculoCorte[], valor: (c: CalculoCorte) => number): Map<CalculoCorte, number> {
  const orden = [...new Set(cs.map(valor))].sort((a, b) => a - b);
  return new Map(cs.map((c) => [c, orden.indexOf(valor(c))]));
}

/** Ordena cálculos ya hechos con el criterio de sugerencia. */
export function ordenarCalculos(calculos: CalculoCorte[], criterio: CriterioFormato = "precio"): CalculoCorte[] {
  const sirven = calculos.filter((c) => !c.problema);
  const porPrecio = puestos(sirven, (c) => c.total);
  const porMerma = puestos(sirven, (c) => c.desperdicioPct);
  const promedio = (c: CalculoCorte) => ((porPrecio.get(c) ?? 0) + (porMerma.get(c) ?? 0)) / 2;
  const firma = (c: CalculoCorte) => c.formatos.map((f) => f.codigo).join("+");
  const codigo = (a: CalculoCorte, b: CalculoCorte) => firma(a).localeCompare(firma(b));

  return [...calculos].sort((a, b) => {
    const sirve = Number(!!a.problema) - Number(!!b.problema);
    if (sirve) return sirve;
    switch (criterio) {
      case "tamano":
        return areaDe(a) - areaDe(b) || a.total - b.total || codigo(a, b);
      case "merma":
        return a.desperdicioPct - b.desperdicioPct || a.total - b.total || areaDe(a) - areaDe(b) || codigo(a, b);
      case "promedio":
        return (
          promedio(a) - promedio(b) ||
          a.total - b.total ||
          a.desperdicioPct - b.desperdicioPct ||
          areaDe(a) - areaDe(b) ||
          codigo(a, b)
        );
      default:
        return a.total - b.total || a.desperdicioPct - b.desperdicioPct || areaDe(a) - areaDe(b) || codigo(a, b);
    }
  });
}

/**
 * Lo que eligió a mano quien arma el corte. Sin elección (`null`) manda la
 * sugerencia: la plancha que convenga, con los sobrantes del almacén primero.
 *  - "formato": solo planchas nuevas de ese formato.
 *  - "sobrante": ese sobrante primero; lo que no quepa, de planchas nuevas.
 */
export type EleccionPlancha = { tipo: "formato"; codigo: string } | { tipo: "sobrante"; codigo: string };

export const mismaEleccion = (a: EleccionPlancha | null | undefined, b: EleccionPlancha | null | undefined) =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.tipo === b.tipo && a.codigo === b.codigo);

/**
 * Del área de las planchas que de verdad se abren (sobrantes incluidos), la que
 * no acaba en una pieza. `desperdicioPct` mide el acomodo con que se cobra, que
 * es siempre sobre planchas nuevas.
 */
export function desperdicioFisicoPct(c: Pick<CalculoCorte, "planchas">): number {
  const area = c.planchas.reduce((s, p) => s + p.ancho * p.alto, 0);
  const usada = c.planchas.reduce((s, p) => s + p.areaUsada, 0);
  return area > 0 ? Math.max(0, (1 - usada / area) * 100) : 0;
}

/** Cuántas piezas salen de un sobrante en un cálculo. */
export function piezasEnSobrante(c: Pick<CalculoCorte, "planchas">, codigo: string): number {
  return c.planchas.reduce(
    (s, p) => s + (p.origen.tipo === "sobrante" && p.origen.id === codigo ? p.piezas : 0),
    0,
  );
}

/**
 * El corte con un sobrante elegido: primero ese pedazo y, lo que no quepa, de
 * planchas nuevas de `formato`. El precio es el de siempre. Si ninguna pieza
 * entra en el sobrante, el cálculo lo dice en `problema`.
 */
export function calcularConSobrante(
  entrada: EntradaCorte,
  formato: FormatoCorte,
  config: ConfigCortes,
  sobrante: Contenedor,
): CalculoCorte {
  const c = calcularCorte(entrada, formato, config, [sobrante]);
  if (c.problema || piezasEnSobrante(c, sobrante.id) > 0) return c;
  return {
    ...c,
    problema: `Ninguna pieza entra en el sobrante ${sobrante.id} (${numero(sobrante.ancho)}×${numero(sobrante.alto)} cm).`,
  };
}

/**
 * El cálculo de una elección a mano, o `null` si lo elegido ya no existe (el
 * formato salió del catálogo, el sobrante ya no está disponible). Con un
 * sobrante, lo que no quepa va al primer formato de `formatos` que sirva.
 */
export function calcularEleccion(
  entrada: EntradaCorte,
  formatos: FormatoCorte[],
  config: ConfigCortes,
  sobrantes: Contenedor[],
  eleccion: EleccionPlancha,
  criterio: CriterioFormato = config.sugerencia.politica,
): CalculoCorte | null {
  if (eleccion.tipo === "formato") {
    const f = formatos.find((x) => x.codigo === eleccion.codigo);
    return f ? calcularCorte(entrada, f, config) : null;
  }
  const s = sobrantes.find((x) => x.id === eleccion.codigo);
  if (!s) return null;
  const base = compararFormatos(entrada, formatos, config, [], criterio)[0];
  return base ? calcularConSobrante(entrada, base.formato, config, s) : null;
}
