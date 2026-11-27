/**
 * Costo de adquisición de las planchas y precio de venta por margen.
 *
 * Todo es puro: recibe números y devuelve números, sin Supabase ni Odoo. Lo usan
 * la vista previa de la liquidación (navegador), el cierre de la liquidación
 * (servidor) y "Costos y precios". Por eso el cálculo es uno solo.
 *
 * Cómo se reparte (decidido con Administración):
 *  - La MERCADERÍA no se reparte: cada ítem lleva su precio del proveedor
 *    (precio unitario × cantidad, del PDF), convertido con el TC de mercadería.
 *  - Cada GASTO se reparte según lo que lo genera:
 *      · por VALOR: lo que cobra un % de lo que vale (seguro, ad valorem,
 *        agente de aduanas). Un ítem caro carga más.
 *      · por PESO: lo que cuesta mover kilos (flete, visto bueno, almacén,
 *        sobreestadía, tráiler, montacarga, mano de obra, combustible).
 *      · por CANTIDAD: igual para cada plancha (opcional, se elige a mano).
 *      · NO_COSTO: el IGV, el IPM y la percepción son crédito fiscal. Se
 *        registran para controlar lo pagado, pero no suben el costo.
 *  - Los gastos en dólares pasan a soles con el TC de gastos.
 *
 * Antes se sumaba todo (mercadería incluida) y se dividía entre los kilos. Así un
 * acrílico barato y uno caro salían con el mismo costo por kilo.
 */

import { z } from "zod";

/* ── Catálogo de gastos ────────────────────────────────────────────────────── */

export type TipoCompra = "nacional" | "importacion";
export type Moneda = "PEN" | "USD";
export type Incoterm = "FOB" | "CIF";
export type Reparto = "valor" | "peso" | "cantidad" | "no_costo";
export type TipoManoObra = "descarga" | "supervision" | "despacho";

export const CONCEPTOS = [
  "flete_maritimo",
  "seguro",
  "ad_valorem",
  "ipm",
  "igv",
  "percepcion_igv",
  "agente_aduanas",
  "visto_bueno",
  "almacen_aduanero",
  "sobreestadia",
  "transporte",
  "montacarga",
  "mano_obra",
  "combustible",
  "otro",
] as const;

export type ConceptoGasto = (typeof CONCEPTOS)[number];

export type GrupoGasto = "flete" | "dam" | "aduana" | "logistica" | "personal" | "otro";

export interface DefConcepto {
  etiqueta: string;
  grupo: GrupoGasto;
  /** En qué compras se ofrece. */
  tipos: TipoCompra[];
  reparto: Reparto;
  moneda: Moneda;
  /** Solo existe si el incoterm es FOB: en CIF va dentro del precio. */
  soloFob?: boolean;
  ayuda?: string;
}

const AMBAS: TipoCompra[] = ["nacional", "importacion"];
const IMPORT: TipoCompra[] = ["importacion"];

export const CONCEPTOS_GASTO: Record<ConceptoGasto, DefConcepto> = {
  flete_maritimo: { etiqueta: "Transporte marítimo", grupo: "flete", tipos: IMPORT, reparto: "peso", moneda: "USD", soloFob: true },
  seguro: { etiqueta: "Seguro", grupo: "flete", tipos: IMPORT, reparto: "valor", moneda: "USD", soloFob: true },
  ad_valorem: { etiqueta: "Ad valorem", grupo: "dam", tipos: IMPORT, reparto: "valor", moneda: "USD", ayuda: "Casilla 4.1 de la DAM" },
  ipm: { etiqueta: "IPM", grupo: "dam", tipos: IMPORT, reparto: "no_costo", moneda: "USD", ayuda: "Imp. de Promoción Municipal (4.5). Crédito fiscal." },
  igv: { etiqueta: "IGV", grupo: "dam", tipos: IMPORT, reparto: "no_costo", moneda: "USD", ayuda: "Imp. General a las Ventas (4.6). Crédito fiscal." },
  percepcion_igv: { etiqueta: "Percepción IGV", grupo: "dam", tipos: IMPORT, reparto: "no_costo", moneda: "PEN", ayuda: "Se paga en soles. Crédito fiscal." },
  agente_aduanas: { etiqueta: "Agente de aduanas", grupo: "aduana", tipos: IMPORT, reparto: "valor", moneda: "USD" },
  visto_bueno: { etiqueta: "Visto bueno", grupo: "aduana", tipos: IMPORT, reparto: "peso", moneda: "USD" },
  almacen_aduanero: { etiqueta: "Almacén (almacenero)", grupo: "aduana", tipos: IMPORT, reparto: "peso", moneda: "USD" },
  sobreestadia: { etiqueta: "Sobreestadía", grupo: "aduana", tipos: IMPORT, reparto: "peso", moneda: "USD" },
  transporte: { etiqueta: "Transporte (tráiler / camión)", grupo: "logistica", tipos: AMBAS, reparto: "peso", moneda: "PEN" },
  montacarga: { etiqueta: "Montacarga", grupo: "logistica", tipos: IMPORT, reparto: "peso", moneda: "PEN" },
  mano_obra: { etiqueta: "Mano de obra", grupo: "personal", tipos: AMBAS, reparto: "peso", moneda: "PEN", ayuda: "Personas × horas × tarifa" },
  combustible: { etiqueta: "Combustible", grupo: "personal", tipos: AMBAS, reparto: "peso", moneda: "PEN", ayuda: "Cuando el despacho lo hacemos nosotros" },
  otro: { etiqueta: "Otro gasto", grupo: "otro", tipos: AMBAS, reparto: "peso", moneda: "PEN" },
};

export const GRUPOS_GASTO: Record<GrupoGasto, string> = {
  flete: "Flete y seguro",
  dam: "DAM · numeración y percepción",
  aduana: "Aduana y almacén",
  logistica: "Transporte y descarga",
  personal: "Personal y combustible",
  otro: "Otros",
};

export const REPARTOS: Record<Reparto, string> = {
  valor: "Por valor",
  peso: "Por kilos",
  cantidad: "Por plancha",
  no_costo: "No es costo (crédito fiscal)",
};

export const TIPOS_MANO_OBRA: Record<TipoManoObra, string> = {
  descarga: "Descarga",
  supervision: "Supervisión del despacho",
  despacho: "Despacho propio",
};

/** Los conceptos que ofrece una compra: sin flete ni seguro si es CIF. */
export function conceptosDe(tipo: TipoCompra, incoterm: Incoterm | null): ConceptoGasto[] {
  return CONCEPTOS.filter((c) => {
    const d = CONCEPTOS_GASTO[c];
    return d.tipos.includes(tipo) && !(d.soloFob && incoterm === "CIF");
  });
}

/* ── Liquidación ───────────────────────────────────────────────────────────── */

export interface CompraCosteo {
  tipo: TipoCompra;
  monedaMercaderia: Moneda;
  /** Soles por dólar para la mercadería. Con mercadería en soles no se usa. */
  tcMercaderia: number | null;
  /** Soles por dólar para los gastos en dólares. */
  tcGastos: number | null;
  incoterm: Incoterm | null;
}

export interface LineaCosteo {
  cantidad: number;
  /** Kilos del ítem completo (no por plancha), como vienen en el PDF. */
  kilos: number | null;
  /** En la moneda de la mercadería. */
  precioUnitario: number;
}

export interface GastoCosteo {
  concepto: ConceptoGasto;
  moneda: Moneda;
  /** Ya resuelto: para la mano de obra, personas × horas × tarifa. */
  monto: number;
  reparto: Reparto;
}

export interface LineaLiquidada {
  /** Mercadería del ítem en soles. */
  mercaderiaPen: number;
  /** Lo que el ítem carga de cada concepto (solo los que son costo), en soles. */
  gastos: Partial<Record<ConceptoGasto, number>>;
  gastosPen: number;
  costoTotalPen: number;
  costoUnitarioPen: number;
  costoUnitarioUsd: number | null;
  costoKgPen: number | null;
}

export interface Liquidacion {
  lineas: LineaLiquidada[];
  mercaderiaPen: number;
  /** Gastos que suben el costo. */
  gastosPen: number;
  /** IGV, IPM y percepción: se pagan pero se recuperan. */
  creditoFiscalPen: number;
  costoTotalPen: number;
  kilos: number;
  /** Qué impide cerrar la liquidación. Vacío si se puede. */
  errores: string[];
}

const centimos = (n: number) => Math.round(n * 100);
const deCentimos = (c: number) => c / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Reparte `total` céntimos según `pesos` con el mayor residuo: la suma de las
 * partes es exactamente el total, sin el céntimo perdido del redondeo.
 */
export function repartirCentimos(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (suma <= 0) return pesos.map(() => 0);
  const exactas = pesos.map((p) => (total * p) / suma);
  const partes = exactas.map(Math.floor);
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const orden = exactas
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0 && k < orden.length; k++, resto--) partes[orden[k].i] += 1;
  return partes;
}

export const enSoles = (monto: number, moneda: Moneda, tc: number | null) =>
  moneda === "PEN" ? monto : monto * (tc ?? 0);

export const montoManoObra = (personas: number, horas: number, tarifa: number) =>
  Math.max(0, personas) * Math.max(0, horas) * Math.max(0, tarifa);

export function liquidar(compra: CompraCosteo, lineas: LineaCosteo[], gastos: GastoCosteo[]): Liquidacion {
  const errores: string[] = [];
  const tcOk = (tc: number | null) => tc !== null && Number.isFinite(tc) && tc > 0;

  if (lineas.length === 0) errores.push("La compra no tiene ítems.");
  if (lineas.some((l) => !(l.cantidad > 0))) errores.push("Cada ítem tiene que tener al menos una plancha.");
  if (compra.monedaMercaderia === "USD" && !tcOk(compra.tcMercaderia)) {
    errores.push("Falta el tipo de cambio de la mercadería.");
  }
  if (gastos.some((g) => g.moneda === "USD" && g.monto > 0) && !tcOk(compra.tcGastos)) {
    errores.push("Falta el tipo de cambio de los gastos.");
  }
  if (compra.incoterm === "CIF") {
    const fob = gastos.filter((g) => CONCEPTOS_GASTO[g.concepto].soloFob && g.monto > 0);
    if (fob.length) errores.push("En CIF el flete marítimo y el seguro ya vienen en el precio: quítalos de los gastos.");
  }
  const porPeso = gastos.some((g) => g.reparto === "peso" && g.monto > 0);
  if (porPeso && lineas.some((l) => !(l.kilos && l.kilos > 0))) {
    errores.push("Hay gastos que se reparten por kilos: escribe los kilos de cada ítem.");
  }

  const tcMerc = compra.monedaMercaderia === "USD" ? compra.tcMercaderia : 1;
  const mercC = lineas.map((l) => centimos(enSoles(l.cantidad * l.precioUnitario, compra.monedaMercaderia, tcMerc)));
  const asignado: Partial<Record<ConceptoGasto, number>>[] = lineas.map(() => ({}));
  const pesosDe: Record<Exclude<Reparto, "no_costo">, number[]> = {
    valor: mercC,
    peso: lineas.map((l) => (l.kilos && l.kilos > 0 ? l.kilos : 0)),
    cantidad: lineas.map((l) => Math.max(0, l.cantidad)),
  };

  let creditoC = 0;
  for (const g of gastos) {
    const totalC = centimos(enSoles(g.monto, g.moneda, compra.tcGastos));
    if (totalC <= 0) continue;
    if (g.reparto === "no_costo") {
      creditoC += totalC;
      continue;
    }
    const pesos = pesosDe[g.reparto];
    if (pesos.reduce((a, b) => a + b, 0) <= 0) {
      errores.push(`No hay con qué repartir "${CONCEPTOS_GASTO[g.concepto].etiqueta}" ${REPARTOS[g.reparto].toLowerCase()}.`);
      continue;
    }
    repartirCentimos(totalC, pesos).forEach((c, i) => {
      asignado[i][g.concepto] = (asignado[i][g.concepto] ?? 0) + c;
    });
  }

  const tcUsd = compra.monedaMercaderia === "USD" ? compra.tcMercaderia : compra.tcGastos;
  const liquidadas: LineaLiquidada[] = lineas.map((l, i) => {
    const gastosC = Object.values(asignado[i]).reduce((a, b) => a + (b ?? 0), 0);
    const totalC = mercC[i] + gastosC;
    const total = deCentimos(totalC);
    const unit = l.cantidad > 0 ? total / l.cantidad : 0;
    return {
      mercaderiaPen: deCentimos(mercC[i]),
      gastos: Object.fromEntries(Object.entries(asignado[i]).map(([k, c]) => [k, deCentimos(c ?? 0)])),
      gastosPen: deCentimos(gastosC),
      costoTotalPen: total,
      costoUnitarioPen: r4(unit),
      costoUnitarioUsd: tcOk(tcUsd) ? r4(unit / (tcUsd as number)) : null,
      costoKgPen: l.kilos && l.kilos > 0 ? r4(total / l.kilos) : null,
    };
  });

  const sumaC = (f: (l: LineaLiquidada) => number) => centimos(liquidadas.reduce((a, l) => a + f(l), 0));
  return {
    lineas: liquidadas,
    mercaderiaPen: deCentimos(sumaC((l) => l.mercaderiaPen)),
    gastosPen: deCentimos(sumaC((l) => l.gastosPen)),
    creditoFiscalPen: deCentimos(creditoC),
    costoTotalPen: deCentimos(sumaC((l) => l.costoTotalPen)),
    kilos: lineas.reduce((a, l) => a + (l.kilos ?? 0), 0),
    errores: [...new Set(errores)],
  };
}

/* ── Precio y margen ───────────────────────────────────────────────────────── */

export type Redondeo = "centimo" | "decimo" | "sol";

export const REDONDEOS: Record<Redondeo, string> = {
  centimo: "Al céntimo",
  decimo: "A S/ 0.10",
  sol: "Al sol",
};

export interface OpcionesPrecio {
  igvPct: number;
  preciosIncluyenIgv: boolean;
  redondeo: Redondeo;
}

const paso: Record<Redondeo, number> = { centimo: 0.01, decimo: 0.1, sol: 1 };

/**
 * El precio de lista para ganar `margenPct` sobre el precio SIN IGV:
 * precio = costo / (1 − margen), más IGV si la lista lo incluye. Se redondea
 * hacia arriba para no quedar por debajo del margen.
 */
export function precioSugerido(costo: number, margenPct: number, o: OpcionesPrecio): number | null {
  if (!(costo > 0) || !(margenPct < 100) || margenPct < 0) return null;
  const sinIgv = costo / (1 - margenPct / 100);
  const lista = o.preciosIncluyenIgv ? sinIgv * (1 + o.igvPct / 100) : sinIgv;
  const p = paso[o.redondeo];
  return Math.round(Math.ceil(lista / p - 1e-9) * p * 100) / 100;
}

/** Precio de lista sin IGV (si la lista lo incluye). */
export const sinIgv = (precio: number, o: Pick<OpcionesPrecio, "igvPct" | "preciosIncluyenIgv">) =>
  o.preciosIncluyenIgv ? precio / (1 + o.igvPct / 100) : precio;

/** Margen sobre el precio sin IGV, en %. `null` si no hay precio. */
export function margenActual(precio: number, costo: number, o: OpcionesPrecio): number | null {
  const base = sinIgv(precio, o);
  if (!(base > 0) || !(costo > 0)) return null;
  return Math.round(((base - costo) / base) * 1000) / 10;
}

/** Promedio ponderado por cantidad; `null` sin historial. */
export function costoPromedio(historial: { cantidad: number; costoUnitarioPen: number }[]): number | null {
  const cant = historial.reduce((a, h) => a + Math.max(0, h.cantidad), 0);
  if (cant <= 0) return null;
  return r4(historial.reduce((a, h) => a + Math.max(0, h.cantidad) * h.costoUnitarioPen, 0) / cant);
}

/* ── Configuración (fila `costos_precios` de `configuracion`) ──────────────── */

export const CLAVE_CONFIG_COSTOS = "costos_precios";

const pct = z.coerce
  .number("El margen es un porcentaje")
  .min(0, "El margen no puede ser negativo")
  .max(95, "Un margen de más de 95% no es razonable");

const tarifa = z.coerce.number("La tarifa es un número").min(0, "La tarifa no puede ser negativa").max(1000, "Esa tarifa no es razonable");

export const esquemaConfigCostos = z.object({
  margenDefecto: pct,
  margenPorMaterial: z.record(z.string().trim().min(1).max(80), pct),
  igvPct: z.coerce.number().min(0).max(50),
  preciosIncluyenIgv: z.boolean(),
  redondeo: z.enum(["centimo", "decimo", "sol"]),
  tarifasManoObra: z.object({ descarga: tarifa, supervision: tarifa, despacho: tarifa }),
});

export type ConfigCostos = z.infer<typeof esquemaConfigCostos>;

export const CONFIG_COSTOS_POR_DEFECTO: ConfigCostos = {
  margenDefecto: 30,
  margenPorMaterial: {},
  igvPct: 18,
  preciosIncluyenIgv: true,
  redondeo: "decimo",
  tarifasManoObra: { descarga: 0, supervision: 0, despacho: 0 },
};

/** Lo guardado, valor por valor; el defecto en lo que falte o no se entienda. */
export function leerConfigCostos(json: unknown): ConfigCostos {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const d = CONFIG_COSTOS_POR_DEFECTO;
  const campo = <K extends keyof ConfigCostos>(k: K): ConfigCostos[K] => {
    const r = esquemaConfigCostos.shape[k].safeParse(o[k]);
    return (r.success ? r.data : d[k]) as ConfigCostos[K];
  };
  const tarifas = (o.tarifasManoObra && typeof o.tarifasManoObra === "object" ? o.tarifasManoObra : {}) as Record<string, unknown>;
  const t = (k: TipoManoObra) => {
    const r = tarifa.safeParse(tarifas[k]);
    return r.success ? r.data : d.tarifasManoObra[k];
  };
  return {
    margenDefecto: campo("margenDefecto"),
    margenPorMaterial: campo("margenPorMaterial"),
    igvPct: campo("igvPct"),
    preciosIncluyenIgv: campo("preciosIncluyenIgv"),
    redondeo: campo("redondeo"),
    tarifasManoObra: { descarga: t("descarga"), supervision: t("supervision"), despacho: t("despacho") },
  };
}

/** El margen objetivo: la excepción de la plancha, el de su material o el general. */
export function margenObjetivo(
  config: ConfigCostos,
  material: string,
  excepcion: number | null | undefined,
): { pct: number; origen: "plancha" | "material" | "general" } {
  if (excepcion !== null && excepcion !== undefined) return { pct: excepcion, origen: "plancha" };
  const m = config.margenPorMaterial[material];
  if (m !== undefined) return { pct: m, origen: "material" };
  return { pct: config.margenDefecto, origen: "general" };
}
