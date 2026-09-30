/**
 * Las métricas del dashboard de Administración (`/metricas`).
 *
 * Todo sale de los mismos `Pedido[]` que el layout ya cargó para las vistas: no hay
 * consultas propias ni tablas de resumen. Son funciones puras —reciben los pedidos,
 * el período y el "hoy" de Lima— para que el número que ve el gerente se pueda
 * rehacer a mano con la misma definición, y para que cambiar de período sea
 * recalcular, no volver a pedir nada.
 *
 * Tres criterios que atraviesan todo el archivo:
 *   - **Venta** es un pedido registrado en el período que no se anuló. La plata que
 *     entra de verdad es otra cosa: los abonos, por la fecha en que se pagaron.
 *   - Las fechas son días de Lima en ISO corto (`2026-09-29`). Se comparan como
 *     texto y se restan en UTC: así no hay huso horario que corra un día.
 *   - Lo que no está en el modelo no se inventa: no hay costos (no hay margen) ni
 *     tabla de clientes (se agrupan por el nombre normalizado).
 */

import {
  ESTADOS,
  METODOS,
  PAGOS,
  PRODUCTOS,
  TIPOS,
  esTerminal,
  saldoDe,
  sumarDias,
  venceCreditoEl,
  type Estado,
  type Pedido,
  type ProductoTerminado,
  type TipoPedido,
} from "./dominio";

/* ── Fechas ── */

const DIA_MS = 86_400_000;

/** Milisegundos desde la época de un `2026-09-29` o `2026-09-29T16:05`, leídos en UTC. */
function instante(iso: string): number {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const hora = iso.length >= 16 ? Number(iso.slice(11, 13)) : 0;
  const minuto = iso.length >= 16 ? Number(iso.slice(14, 16)) : 0;
  return Date.UTC(a, m - 1, d, hora, minuto);
}

/** Días enteros de `desde` a `hasta`. Negativo si `hasta` va antes. */
export const diasEntre = (desde: string, hasta: string) =>
  Math.round((instante(hasta) - instante(desde)) / DIA_MS);

/** Días con decimales entre dos momentos: lo que duró una etapa. */
const duracionDias = (desde: string, hasta: string) => (instante(hasta) - instante(desde)) / DIA_MS;

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Último día del mes (`mes` de 1 a 12). */
const finDeMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** `2026-09-29` → `2026-08-29`, recortando al último día si el mes es más corto. */
function mesAntes(fecha: string, meses = 1): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const indice = a * 12 + (m - 1) - meses;
  const na = Math.floor(indice / 12);
  const nm = (indice % 12) + 1;
  return iso(na, nm, Math.min(d, finDeMes(na, nm)));
}

const mesCorto = new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" });
const diaYMes = new Intl.DateTimeFormat("es-PE", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** `2026-09-01` → `set` (sin el punto de la abreviatura: va en ejes estrechos). */
export const etiquetaMes = (fecha: string) =>
  mesCorto.format(new Date(instante(fecha))).replace(".", "");

/** `2026-09-01` → `1 set` */
export const etiquetaDia = (fecha: string) =>
  diaYMes.format(new Date(instante(fecha))).replace(".", "");

/* ── Períodos ── */

export type ClavePeriodo = "mes" | "mes-pasado" | "90d" | "anio" | "rango";

export const PERIODOS: Record<ClavePeriodo, string> = {
  mes: "Este mes",
  "mes-pasado": "Mes pasado",
  "90d": "Últimos 90 días",
  anio: "Este año",
  rango: "Personalizado",
};

/** Un intervalo de días, con los dos extremos incluidos. */
export interface Rango {
  desde: string;
  hasta: string;
}

export interface Periodo extends Rango {
  clave: ClavePeriodo;
  /** Contra qué se compara: el mismo largo, justo antes. */
  anterior: Rango;
  /** Cómo se nombra el anterior en los deltas: "vs mes pasado". */
  nombreAnterior: string;
}

export const enRango = (r: Rango, fecha: string | null | undefined): fecha is string =>
  !!fecha && fecha.slice(0, 10) >= r.desde && fecha.slice(0, 10) <= r.hasta;

export const largoDe = (r: Rango) => diasEntre(r.desde, r.hasta) + 1;

/** El rango del mismo largo que termina el día antes de que empiece `r`. */
function rangoPrevio(r: Rango): Rango {
  const hasta = sumarDias(r.desde, -1);
  return { desde: sumarDias(hasta, -(largoDe(r) - 1)), hasta };
}

/**
 * Traduce la elección del selector a fechas.
 *
 * "Este mes" se compara **mes a la fecha**: del 1 al 29 de setiembre contra del 1
 * al 29 de agosto, no contra agosto entero. Comparar 29 días con 31 haría que todo
 * mes en curso pareciera una caída.
 */
export function resolverPeriodo(
  clave: ClavePeriodo,
  hoyIso: string,
  personalizado?: Partial<Rango>,
): Periodo {
  const [a, m] = hoyIso.split("-").map(Number);

  switch (clave) {
    case "mes": {
      const desde = iso(a, m, 1);
      return {
        clave,
        desde,
        hasta: hoyIso,
        anterior: { desde: mesAntes(desde), hasta: mesAntes(hoyIso) },
        nombreAnterior: "el mismo tramo del mes pasado",
      };
    }
    case "mes-pasado": {
      const desde = mesAntes(iso(a, m, 1));
      const [pa, pm] = desde.split("-").map(Number);
      const previo = mesAntes(desde);
      const [aa, am] = previo.split("-").map(Number);
      return {
        clave,
        desde,
        hasta: iso(pa, pm, finDeMes(pa, pm)),
        anterior: { desde: previo, hasta: iso(aa, am, finDeMes(aa, am)) },
        nombreAnterior: "el mes anterior",
      };
    }
    case "anio": {
      const desde = iso(a, 1, 1);
      return {
        clave,
        desde,
        hasta: hoyIso,
        anterior: { desde: iso(a - 1, 1, 1), hasta: mesAntes(hoyIso, 12) },
        nombreAnterior: "el mismo tramo del año pasado",
      };
    }
    case "rango": {
      const desde = personalizado?.desde || iso(a, m, 1);
      const hasta = personalizado?.hasta || hoyIso;
      // Un rango al revés no es un error del gerente que valga una pantalla vacía.
      const r = desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
      return { clave, ...r, anterior: rangoPrevio(r), nombreAnterior: "el período anterior" };
    }
    case "90d":
    default: {
      const r = { desde: sumarDias(hoyIso, -89), hasta: hoyIso };
      return {
        clave: "90d",
        ...r,
        anterior: rangoPrevio(r),
        nombreAnterior: "los 90 días anteriores",
      };
    }
  }
}

/* ── Utilidades ── */

const suma = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/** Variación relativa; `null` cuando no hay base contra la que comparar. */
export const variacion = (actual: number, anterior: number) =>
  anterior > 0 ? (actual - anterior) / anterior : null;

/** Una fila de un ranking: qué es, cuánto vale y cuántos pedidos la forman. */
export interface Fila {
  clave: string;
  etiqueta: string;
  monto: number;
  pedidos: number;
}

function agruparFilas<T>(
  items: T[],
  clave: (x: T) => string,
  etiqueta: (x: T) => string,
  monto: (x: T) => number,
): Fila[] {
  const mapa = new Map<string, Fila>();
  for (const x of items) {
    const k = clave(x);
    const fila = mapa.get(k) ?? { clave: k, etiqueta: etiqueta(x), monto: 0, pedidos: 0 };
    fila.monto += monto(x);
    fila.pedidos += 1;
    mapa.set(k, fila);
  }
  return [...mapa.values()].sort((a, b) => b.monto - a.monto || b.pedidos - a.pedidos);
}

/**
 * El cliente es texto libre: "Inversiones Díaz " y "inversiones diaz" son el mismo.
 * Sin tildes, sin mayúsculas y sin espacios de más; nada más agresivo que eso,
 * porque juntar a dos clientes distintos es peor que separar a uno.
 */
export const claveCliente = (nombre: string) =>
  nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Los pedidos que cuentan como venta en un rango: registrados en él y no anulados. */
export const vendidosEn = (pedidos: Pedido[], r: Rango) =>
  pedidos.filter((p) => p.estado !== "anulado" && enRango(r, p.fechaCreacion));

/* ── Ventas ── */

export interface Ventas {
  vendido: number;
  pedidos: number;
  ticket: number;
}

export function ventas(pedidos: Pedido[], r: Rango): Ventas {
  const vendidos = vendidosEn(pedidos, r);
  const vendido = suma(vendidos.map((p) => p.montoTotal));
  return {
    vendido,
    pedidos: vendidos.length,
    ticket: vendidos.length ? vendido / vendidos.length : 0,
  };
}

export type TipoMezcla = TipoPedido | "MX";

export const TIPOS_MEZCLA: Record<TipoMezcla, string> = { ...TIPOS, MX: "Mixto" };

/**
 * Por tipo de trabajo. Un pedido que combina trabajos no se reparte entre sus tipos
 * —no hay forma honesta de partir su monto— y va a "Mixto", como su código.
 */
export const ventasPorTipo = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(
    vendidosEn(pedidos, r),
    (p) => (p.tipos.length > 1 ? "MX" : (p.tipos[0] ?? "CL")),
    (p) => TIPOS_MEZCLA[p.tipos.length > 1 ? "MX" : (p.tipos[0] ?? "CL")],
    (p) => p.montoTotal,
  );

/** Qué productos terminados se venden. Un pedido combinado cuenta con todo su monto. */
export const ventasPorProducto = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(
    vendidosEn(pedidos, r).filter((p) => p.producto),
    (p) => p.producto!,
    (p) => PRODUCTOS[p.producto as ProductoTerminado],
    (p) => p.montoTotal,
  );

export const ventasPorDestino = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(
    vendidosEn(pedidos, r),
    (p) => (p.esProvincia ? "provincia" : "lima"),
    (p) => (p.esProvincia ? "Provincia" : "Lima"),
    (p) => p.montoTotal,
  );

/** Cómo se vendió: al contado, a cuenta o al crédito. */
export const ventasPorTipoPago = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(
    vendidosEn(pedidos, r),
    (p) => p.tipoPago,
    (p) => PAGOS[p.tipoPago],
    (p) => p.montoTotal,
  );

export const ventasPorDepartamento = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(
    vendidosEn(pedidos, r).filter((p) => p.esProvincia),
    (p) => p.envio?.departamento || "Sin departamento",
    (p) => p.envio?.departamento || "Sin departamento",
    (p) => p.montoTotal,
  );

/**
 * Quién registró cada pedido. No hay columna con el nombre: sale de la primera
 * entrada del historial, la de "registrado", que firma quien lo creó.
 */
export const registradoPor = (p: Pedido) =>
  p.historial.find((h) => h.estado === "registrado")?.usuario ?? "Sin dato";

export const ventasPorRegistrador = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(vendidosEn(pedidos, r), registradoPor, registradoPor, (p) => p.montoTotal);

/* ── Cobranza ── */

/** La caja: lo que se abonó en el rango, sea del pedido que sea. */
export const abonosEn = (pedidos: Pedido[], r: Rango) =>
  pedidos.flatMap((p) => p.abonos.filter((a) => enRango(r, a.fecha)));

export const cobradoEn = (pedidos: Pedido[], r: Rango) =>
  suma(abonosEn(pedidos, r).map((a) => a.monto));

/** Por método de pago. `pedidos` aquí cuenta abonos, no pedidos. */
export const cobradoPorMetodo = (pedidos: Pedido[], r: Rango) =>
  agruparFilas(
    abonosEn(pedidos, r),
    (a) => a.metodo,
    (a) => METODOS[a.metodo],
    (a) => a.monto,
  );

/** Lo que se debe hoy. Una foto: no depende del período elegido. */
export const conDeuda = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.estado !== "anulado" && saldoDe(p) > 0);

/**
 * Desde cuándo se debe un saldo. Al crédito, desde que vence el plazo; al contado
 * o a cuenta, desde la entrega —se entregó sin terminar de cobrar—. Un pedido que
 * todavía está en el taller no tiene deuda vencida: el cliente aún no recibió nada.
 */
export function venceDeudaEl(p: Pedido): string | null {
  if (p.tipoPago === "credito") return venceCreditoEl(p);
  return p.fechaEntrega ?? null;
}

/** Días que lleva vencida la deuda; 0 si todavía no vence. */
export function diasDeAtraso(p: Pedido, hoyIso: string) {
  const vence = venceDeudaEl(p);
  return vence && vence < hoyIso ? diasEntre(vence, hoyIso) : 0;
}

export type TramoDeuda = "al-dia" | "1-7" | "8-30" | "31-60" | "60+";

export const TRAMOS_DEUDA: Record<TramoDeuda, string> = {
  "al-dia": "No vencida",
  "1-7": "1–7 días",
  "8-30": "8–30 días",
  "31-60": "31–60 días",
  "60+": "Más de 60",
};

const tramoDe = (dias: number): TramoDeuda =>
  dias <= 0 ? "al-dia" : dias <= 7 ? "1-7" : dias <= 30 ? "8-30" : dias <= 60 ? "31-60" : "60+";

export interface Cartera {
  porCobrar: number;
  vencida: number;
  pedidos: number;
  /** En el orden de `TRAMOS_DEUDA`, de la más fresca a la más vieja. */
  tramos: Fila[];
}

export function cartera(pedidos: Pedido[], hoyIso: string): Cartera {
  const deuda = conDeuda(pedidos);
  const tramos = (Object.keys(TRAMOS_DEUDA) as TramoDeuda[]).map((t) => ({
    clave: t,
    etiqueta: TRAMOS_DEUDA[t],
    monto: 0,
    pedidos: 0,
  }));
  for (const p of deuda) {
    const fila = tramos.find((f) => f.clave === tramoDe(diasDeAtraso(p, hoyIso)))!;
    fila.monto += saldoDe(p);
    fila.pedidos += 1;
  }
  const porCobrar = suma(deuda.map(saldoDe));
  return {
    porCobrar,
    vencida: porCobrar - tramos[0].monto,
    pedidos: deuda.length,
    tramos,
  };
}

export interface Deudor {
  clave: string;
  cliente: string;
  pedidos: number;
  saldo: number;
  diasAtraso: number;
  /** El pedido con la deuda más vieja: adonde lleva el enlace. */
  codigo: string;
}

export function deudores(pedidos: Pedido[], hoyIso: string, limite = 10): Deudor[] {
  const mapa = new Map<string, Deudor>();
  for (const p of conDeuda(pedidos)) {
    const k = claveCliente(p.cliente);
    const atraso = diasDeAtraso(p, hoyIso);
    const d = mapa.get(k) ?? {
      clave: k,
      cliente: p.cliente.trim(),
      pedidos: 0,
      saldo: 0,
      diasAtraso: -1,
      codigo: p.codigo,
    };
    d.pedidos += 1;
    d.saldo += saldoDe(p);
    if (atraso > d.diasAtraso) {
      d.diasAtraso = atraso;
      d.codigo = p.codigo;
    }
    mapa.set(k, d);
  }
  return [...mapa.values()].sort((a, b) => b.saldo - a.saldo).slice(0, limite);
}

/** El flete de provincia que el cliente todavía no pagó. */
export function fletePorCobrar(pedidos: Pedido[]) {
  const pendientes = pedidos.filter(
    (p) => p.estado !== "anulado" && p.envio && !p.envio.fletePagado && p.envio.montoFlete > 0,
  );
  return { monto: suma(pendientes.map((p) => p.envio!.montoFlete)), pedidos: pendientes.length };
}

/* ── Cumplimiento ── */

export const entregadosEn = (pedidos: Pedido[], r: Rango) =>
  pedidos.filter((p) => p.estado === "entregado" && enRango(r, p.fechaEntrega));

export const aTiempo = (p: Pedido) => !!p.fechaEntrega && p.fechaEntrega <= p.fechaPrometida;

export interface Cumplimiento {
  entregados: number;
  aTiempo: number;
  /** De 0 a 1; `null` si no se entregó nada en el período. */
  tasaATiempo: number | null;
  /** Días promedio de registrado a entregado. */
  diasPromedio: number | null;
  registrados: number;
  tasaObservados: number | null;
  tasaAnulados: number | null;
}

const pasoPor = (p: Pedido, e: Estado) => p.estado === e || p.historial.some((h) => h.estado === e);

export function cumplimiento(pedidos: Pedido[], r: Rango): Cumplimiento {
  const entregados = entregadosEn(pedidos, r);
  const puntuales = entregados.filter(aTiempo).length;
  // Aquí sí entran los anulados: la pregunta es qué parte de lo que entró se cayó.
  const registrados = pedidos.filter((p) => enRango(r, p.fechaCreacion));
  const tasa = (n: number) => (registrados.length ? n / registrados.length : null);

  return {
    entregados: entregados.length,
    aTiempo: puntuales,
    tasaATiempo: entregados.length ? puntuales / entregados.length : null,
    diasPromedio: entregados.length
      ? suma(entregados.map((p) => diasEntre(p.fechaCreacion, p.fechaEntrega!))) /
        entregados.length
      : null,
    registrados: registrados.length,
    tasaObservados: tasa(registrados.filter((p) => pasoPor(p, "observado")).length),
    tasaAnulados: tasa(registrados.filter((p) => p.estado === "anulado").length),
  };
}

/** Activos cuya fecha prometida ya pasó. */
export const atrasados = (pedidos: Pedido[], hoyIso: string) =>
  pedidos.filter((p) => !esTerminal(p.estado) && p.fechaPrometida < hoyIso);

/** Lo que está en curso ahora, por estado, en el orden del flujo. */
export function pipeline(pedidos: Pedido[]): Fila[] {
  const activos: Estado[] = ["registrado", "en_proceso", "observado", "listo", "en_transito"];
  return activos.map((e) => {
    const deEste = pedidos.filter((p) => p.estado === e);
    return {
      clave: e,
      etiqueta: ESTADOS[e],
      monto: suma(deEste.map((p) => p.montoTotal)),
      pedidos: deEste.length,
    };
  });
}

export interface Etapa {
  estado: Estado;
  etiqueta: string;
  /** Días promedio que un pedido pasa en este estado, entre los que pasaron por él. */
  dias: number;
  pedidos: number;
}

/**
 * Cuánto se queda un pedido en cada estado, sobre los entregados del período. El
 * tiempo de un estado es lo que va de su entrada en el historial a la siguiente.
 * El más largo es el cuello de botella.
 */
export function tiemposPorEtapa(pedidos: Pedido[], r: Rango): Etapa[] {
  const total = new Map<Estado, { dias: number; pedidos: Set<string> }>();
  for (const p of entregadosEn(pedidos, r)) {
    const h = p.historial;
    for (let i = 0; i < h.length - 1; i++) {
      const dias = duracionDias(h[i].fecha, h[i + 1].fecha);
      if (dias < 0) continue;
      const t = total.get(h[i].estado) ?? { dias: 0, pedidos: new Set<string>() };
      t.dias += dias;
      t.pedidos.add(p.codigo);
      total.set(h[i].estado, t);
    }
  }
  const orden: Estado[] = ["registrado", "en_proceso", "observado", "listo", "en_transito"];
  return orden
    .filter((e) => total.has(e))
    .map((e) => {
      const t = total.get(e)!;
      // Los días se promedian por pedido, no por visita: un pedido que se observó
      // dos veces pasó ese tiempo en total, y así es como lo sufre el cliente.
      return {
        estado: e,
        etiqueta: ESTADOS[e],
        dias: t.dias / t.pedidos.size,
        pedidos: t.pedidos.size,
      };
    });
}

export interface Responsable {
  nombre: string;
  activos: number;
  atrasados: number;
  entregados: number;
  tasaATiempo: number | null;
  diasPromedio: number | null;
}

export function porResponsable(pedidos: Pedido[], r: Rango, hoyIso: string): Responsable[] {
  const nombres = new Set(pedidos.map((p) => p.responsable ?? "Sin asignar"));
  return [...nombres]
    .map((nombre) => {
      const suyos = pedidos.filter((p) => (p.responsable ?? "Sin asignar") === nombre);
      const activos = suyos.filter((p) => !esTerminal(p.estado));
      const entregados = entregadosEn(suyos, r);
      return {
        nombre,
        activos: activos.length,
        atrasados: atrasados(activos, hoyIso).length,
        entregados: entregados.length,
        tasaATiempo: entregados.length
          ? entregados.filter(aTiempo).length / entregados.length
          : null,
        diasPromedio: entregados.length
          ? suma(entregados.map((p) => diasEntre(p.fechaCreacion, p.fechaEntrega!))) /
            entregados.length
          : null,
      };
    })
    .filter((x) => x.activos > 0 || x.entregados > 0)
    .sort((a, b) => b.activos - a.activos || b.entregados - a.entregados);
}

export interface Motivo {
  motivo: string;
  estado: "observado" | "anulado";
  veces: number;
}

/**
 * Por qué se observan y se anulan los pedidos. El motivo es texto libre, así que se
 * agrupa por el texto normalizado; lo que se muestra es la primera forma escrita.
 */
export function motivosFrecuentes(pedidos: Pedido[], r: Rango, limite = 5): Motivo[] {
  const mapa = new Map<string, Motivo>();
  for (const p of pedidos) {
    for (const h of p.historial) {
      if ((h.estado !== "observado" && h.estado !== "anulado") || !enRango(r, h.fecha)) continue;
      // Una fila de historial sin motivo (las cargadas a mano, como las del seed) toma
      // el del pedido si ese sigue siendo su estado: es el mismo motivo.
      const texto = (h.motivo ?? (p.estado === h.estado ? p.motivo : null))?.trim();
      if (!texto) continue;
      const k = `${h.estado}:${claveCliente(texto)}`;
      const m = mapa.get(k) ?? { motivo: texto, estado: h.estado, veces: 0 };
      m.veces += 1;
      mapa.set(k, m);
    }
  }
  return [...mapa.values()].sort((a, b) => b.veces - a.veces).slice(0, limite);
}

/** Cuántos pedidos activos vencen cada uno de los próximos días, hoy incluido. */
export function proximosDias(pedidos: Pedido[], hoyIso: string, dias = 7) {
  return Array.from({ length: dias }, (_, i) => {
    const fecha = sumarDias(hoyIso, i);
    const deEseDia = pedidos.filter((p) => !esTerminal(p.estado) && p.fechaPrometida === fecha);
    return { fecha, pedidos: deEseDia.length, monto: suma(deEseDia.map((p) => p.montoTotal)) };
  });
}

/** Observados cuyo último cambio de estado fue hace más de `dias` días. */
export function observadosEstancados(pedidos: Pedido[], hoyIso: string, dias = 3) {
  return pedidos.filter((p) => {
    if (p.estado !== "observado") return false;
    const desde = p.historial.findLast((h) => h.estado === "observado")?.fecha;
    return !!desde && diasEntre(desde.slice(0, 10), hoyIso) > dias;
  });
}

/* ── Clientes ── */

export interface Clientes {
  top: Fila[];
  /** Qué parte de lo vendido se llevan el top 3 y el top 10 (de 0 a 1). */
  cuotaTop3: number;
  cuotaTop10: number;
  total: number;
  nuevos: { clientes: number; monto: number };
  recurrentes: { clientes: number; monto: number };
}

export function clientes(pedidos: Pedido[], r: Rango): Clientes {
  const filas = agruparFilas(
    vendidosEn(pedidos, r),
    (p) => claveCliente(p.cliente),
    (p) => p.cliente.trim(),
    (p) => p.montoTotal,
  );
  const vendido = suma(filas.map((f) => f.monto));
  const cuota = (n: number) =>
    vendido ? suma(filas.slice(0, n).map((f) => f.monto)) / vendido : 0;

  // Nuevo es quien no había comprado nada antes de que empezara el período.
  const primeraCompra = new Map<string, string>();
  for (const p of pedidos) {
    if (p.estado === "anulado") continue;
    const k = claveCliente(p.cliente);
    const previa = primeraCompra.get(k);
    if (!previa || p.fechaCreacion < previa) primeraCompra.set(k, p.fechaCreacion);
  }
  const nuevos = filas.filter((f) => (primeraCompra.get(f.clave) ?? "") >= r.desde);
  const recurrentes = filas.filter((f) => (primeraCompra.get(f.clave) ?? "") < r.desde);

  return {
    top: filas.slice(0, 10),
    cuotaTop3: cuota(3),
    cuotaTop10: cuota(10),
    total: filas.length,
    nuevos: { clientes: nuevos.length, monto: suma(nuevos.map((f) => f.monto)) },
    recurrentes: { clientes: recurrentes.length, monto: suma(recurrentes.map((f) => f.monto)) },
  };
}

/* ── Series ── */

export interface Punto {
  clave: string;
  etiqueta: string;
  /** Una etiqueta más larga para el tooltip y la tabla. */
  detalle: string;
  a: number;
  b: number;
}

/**
 * Vendido y cobrado de los últimos `meses` meses, el actual incluido. Es el
 * contexto que no cambia con el selector: la foto de "cómo venimos".
 */
export function serieMensual(pedidos: Pedido[], hoyIso: string, meses = 12): Punto[] {
  const [a, m] = hoyIso.split("-").map(Number);
  return Array.from({ length: meses }, (_, i) => {
    const desde = mesAntes(iso(a, m, 1), meses - 1 - i);
    const [ya, ym] = desde.split("-").map(Number);
    const r = { desde, hasta: iso(ya, ym, finDeMes(ya, ym)) };
    return {
      clave: desde.slice(0, 7),
      etiqueta: etiquetaMes(desde),
      detalle: `${etiquetaMes(desde)} ${ya}`,
      a: ventas(pedidos, r).vendido,
      b: cobradoEn(pedidos, r),
    };
  });
}

/**
 * Lo vendido en el período, en tramos, junto al tramo equivalente del período
 * anterior (`a` el actual, `b` el anterior). Hasta medio año, semanas contadas
 * desde el primer día; más largo, meses del calendario.
 */
export function serieDelPeriodo(pedidos: Pedido[], p: Periodo): Punto[] {
  if (largoDe(p) > 183) {
    const inicioPrevio = `${p.anterior.desde.slice(0, 8)}01`;
    const tramos: Punto[] = [];
    for (let desde = p.desde, i = 0; desde <= p.hasta; i++) {
      const [ya, ym] = desde.split("-").map(Number);
      const finMes = iso(ya, ym, finDeMes(ya, ym));
      const hasta = finMes < p.hasta ? finMes : p.hasta;

      // El mes i del período anterior, recortado a sus bordes.
      const mesPrevio = mesAntes(inicioPrevio, -i);
      const [pa, pm] = mesPrevio.split("-").map(Number);
      const finPrevio = iso(pa, pm, finDeMes(pa, pm));
      const previo = {
        desde: mesPrevio < p.anterior.desde ? p.anterior.desde : mesPrevio,
        hasta: finPrevio < p.anterior.hasta ? finPrevio : p.anterior.hasta,
      };

      tramos.push({
        clave: desde,
        etiqueta: etiquetaMes(desde),
        detalle: `${etiquetaMes(desde)} ${ya}`,
        a: ventas(pedidos, { desde, hasta }).vendido,
        b: previo.desde <= previo.hasta ? ventas(pedidos, previo).vendido : 0,
      });
      desde = sumarDias(finMes, 1);
    }
    return tramos;
  }

  const tramos: Punto[] = [];
  for (let i = 0; i * 7 < largoDe(p); i++) {
    const desde = sumarDias(p.desde, i * 7);
    const finSemana = sumarDias(desde, 6);
    const hasta = finSemana < p.hasta ? finSemana : p.hasta;
    const previoDesde = sumarDias(p.anterior.desde, i * 7);
    const previoFin = sumarDias(previoDesde, diasEntre(desde, hasta));
    const previo = {
      desde: previoDesde,
      hasta: previoFin < p.anterior.hasta ? previoFin : p.anterior.hasta,
    };
    tramos.push({
      clave: desde,
      etiqueta: etiquetaDia(desde),
      detalle:
        desde === hasta ? etiquetaDia(desde) : `${etiquetaDia(desde)} – ${etiquetaDia(hasta)}`,
      a: ventas(pedidos, { desde, hasta }).vendido,
      b: previo.desde <= previo.hasta ? ventas(pedidos, previo).vendido : 0,
    });
  }
  return tramos;
}

/* ── Lo que requiere atención ── */

export interface Alerta {
  clave: "credito" | "entregado-con-saldo" | "atrasados" | "observados";
  titulo: string;
  descripcion: string;
  pedidos: Pedido[];
  /** Lo que está en juego: la deuda en las de cobranza, el valor del pedido en el resto. */
  monto: number;
}

/**
 * Las cuatro cosas que no deberían estar pasando. Cada lista va ordenada por lo que
 * más urge: la deuda más grande o el atraso más largo primero.
 */
export function alertas(pedidos: Pedido[], hoyIso: string): Alerta[] {
  const credito = conDeuda(pedidos)
    .filter((p) => p.tipoPago === "credito" && diasDeAtraso(p, hoyIso) > 0)
    .sort((a, b) => saldoDe(b) - saldoDe(a));
  const entregadosConSaldo = conDeuda(pedidos)
    .filter((p) => p.estado === "entregado" && p.tipoPago !== "credito")
    .sort((a, b) => saldoDe(b) - saldoDe(a));
  const tarde = atrasados(pedidos, hoyIso).sort((a, b) =>
    a.fechaPrometida.localeCompare(b.fechaPrometida),
  );
  const estancados = observadosEstancados(pedidos, hoyIso);

  return [
    {
      clave: "credito",
      titulo: "Créditos vencidos",
      descripcion: "Pasó el plazo de crédito y el cliente todavía debe.",
      pedidos: credito,
      monto: suma(credito.map(saldoDe)),
    },
    {
      clave: "entregado-con-saldo",
      titulo: "Entregados sin cobrar",
      descripcion: "Se entregaron al contado o a cuenta y quedó saldo.",
      pedidos: entregadosConSaldo,
      monto: suma(entregadosConSaldo.map(saldoDe)),
    },
    {
      clave: "atrasados",
      titulo: "Pedidos atrasados",
      descripcion: "Siguen en curso y la fecha prometida ya pasó.",
      pedidos: tarde,
      monto: suma(tarde.map((p) => p.montoTotal)),
    },
    {
      clave: "observados",
      titulo: "Observados hace más de 3 días",
      descripcion: "Detenidos esperando una respuesta.",
      pedidos: estancados,
      monto: suma(estancados.map((p) => p.montoTotal)),
    },
  ];
}
