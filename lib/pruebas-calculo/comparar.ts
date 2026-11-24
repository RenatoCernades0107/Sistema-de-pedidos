/**
 * Lo que cambió entre el resultado aprobado de una prueba de cálculo y el de
 * ahora. Cada valor es de una de dos clases:
 *
 * - `entrada`: un dato del que sale el cálculo (un precio de Odoo, la tabla
 *   del láser, un parámetro del motor). Si cambió, el resultado cambia y es
 *   esperado: falta ver si el dato nuevo es el correcto.
 * - `calculo`: lo que sale (las piezas, el acomodo, los montos). Si cambió y
 *   ninguna entrada cambió, cambió el cálculo mismo: eso es lo que hay que mirar.
 *
 * Puro.
 */

import type { ResultadoPrueba } from "./prueba";

export type ClaseValor = "entrada" | "calculo";

export interface Diferencia {
  /** Clave estable: «piezas.lateral.perimetroMm». */
  ruta: string;
  etiqueta: string;
  clase: ClaseValor;
  /** `null`: no estaba (o ya no está). */
  antes: string | null;
  ahora: string | null;
}

interface Valor {
  etiqueta: string;
  clase: ClaseValor;
  valor: number | string | boolean | null;
  /** Para los números: cuánto pueden diferir sin que cuente. */
  tolerancia: number;
  /** Cómo se muestra. */
  texto: (v: number) => string;
}

/** Montos en soles: medio céntimo. */
const SOLES = 0.005;
/** Milímetros, minutos, porcentajes, planchas. */
const FINO = 0.01;

const soles = (v: number) => `S/ ${v.toFixed(2)}`;
const tal = (v: number) => String(+v.toFixed(4));

function aplanar(r: ResultadoPrueba): Map<string, Valor> {
  const m = new Map<string, Valor>();
  const poner = (
    ruta: string,
    etiqueta: string,
    clase: ClaseValor,
    valor: Valor["valor"],
    tolerancia = FINO,
    texto: Valor["texto"] = tal,
  ) => m.set(ruta, { etiqueta, clase, valor, tolerancia, texto });

  // Entradas
  const e = r.entradas;
  poner("plantilla", "Plantilla del motor", "entrada", `${e.plantilla} v${e.versionPlantilla}`);
  for (const [k, v] of Object.entries(e.parametros)) poner(`parametros.${k}`, `Parámetro «${k}» del motor`, "entrada", v);
  poner("kerf", "Kerf del láser (mm)", "entrada", e.kerfMm);
  poner("margen", "Margen de la plancha (mm)", "entrada", e.margenMm);
  const l = e.laser;
  poner("laser.velocidad", `Láser ${l.espesorMm} mm: velocidad`, "entrada", l.velocidad);
  poner("laser.pierce", `Láser ${l.espesorMm} mm: perforación (s)`, "entrada", l.pierce);
  poner("laser.pasadas", `Láser ${l.espesorMm} mm: pasadas`, "entrada", l.pasadas);
  poner("laser.factorVelocidad", "Rendimiento real del láser", "entrada", l.factorVelocidad);
  poner("laser.overhead", "Tiempo extra por pieza (s)", "entrada", l.overheadPorPieza);
  poner("laser.costoPorMinuto", "Costo por minuto del láser", "entrada", l.costoPorMinuto, SOLES, soles);
  poner("laser.igv", "IGV sobre el servicio (%)", "entrada", l.igvPct);
  poner("cobro.redondear", "Redondear al sol", "entrada", e.redondearAlSol);
  poner("cobro.fracciones", "Fracciones de plancha", "entrada", e.fracciones.join(", "));
  for (const p of e.precios) poner(`precios.${p.codigo}`, `Precio Odoo ${p.codigo} (${p.medida})`, "entrada", p.precio, SOLES, soles);
  poner("factor", `Factor del tipo ${r.producto.tipo}`, "entrada", r.producto.factor);

  // Cálculo
  for (const p of r.piezas) {
    const n = `Pieza «${p.nombre}»`;
    poner(`piezas.${p.id}.cantidad`, `${n}: cantidad`, "calculo", p.cantidad);
    poner(`piezas.${p.id}.espesor`, `${n}: espesor (mm)`, "calculo", p.espesorMm);
    poner(`piezas.${p.id}.ancho`, `${n}: ancho (mm)`, "calculo", p.anchoMm);
    poner(`piezas.${p.id}.alto`, `${n}: alto (mm)`, "calculo", p.altoMm);
    poner(`piezas.${p.id}.area`, `${n}: área (mm²)`, "calculo", p.areaMm2, 1);
    poner(`piezas.${p.id}.perimetro`, `${n}: perímetro (mm)`, "calculo", p.perimetroMm, 0.1);
  }
  for (const g of r.grupos) {
    const n = g.etiqueta;
    poner(`grupos.${n}.formato`, `${n}: formato`, "calculo", g.formato);
    poner(`grupos.${n}.planchas`, `${n}: planchas cobradas`, "calculo", g.planchas);
    poner(`grupos.${n}.planchasAcomodo`, `${n}: planchas del acomodo`, "calculo", g.planchasAcomodo);
    poner(`grupos.${n}.uso`, `${n}: uso de plancha (%)`, "calculo", g.usoPct);
    poner(`grupos.${n}.noCaben`, `${n}: piezas que no entran`, "calculo", g.noCaben);
    poner(`grupos.${n}.material`, `${n}: material`, "calculo", g.material, SOLES, soles);
    poner(`grupos.${n}.minutos`, `${n}: minutos de láser`, "calculo", g.minutosLaser);
    poner(`grupos.${n}.servicio`, `${n}: servicio láser`, "calculo", g.servicio, SOLES, soles);
    poner(`grupos.${n}.total`, `${n}: total`, "calculo", g.total, SOLES, soles);
  }
  const t = r.totales;
  poner("totales.total", "Costo total", "calculo", t?.total ?? null, SOLES, soles);
  poner("totales.costoUnidad", "Costo por unidad", "calculo", t?.costoUnidad ?? null, SOLES, soles);
  poner("totales.sugerido", "Precio sugerido por unidad", "calculo", t?.sugeridoUnidad ?? null, SOLES, soles);
  poner("problemas", "Problemas", "calculo", r.problemas.join(" | ") || null);
  return m;
}

function mostrar(v: Valor | undefined): string | null {
  if (!v || v.valor === null) return null;
  if (typeof v.valor === "number") return v.texto(v.valor);
  if (typeof v.valor === "boolean") return v.valor ? "sí" : "no";
  return v.valor;
}

function iguales(a: Valor | undefined, b: Valor | undefined): boolean {
  const x = a?.valor ?? null;
  const y = b?.valor ?? null;
  if (typeof x === "number" && typeof y === "number") {
    return Math.abs(x - y) <= Math.max(a!.tolerancia, b!.tolerancia) + 1e-9;
  }
  return x === y;
}

/** Las diferencias, primero las entradas y luego el cálculo, en el orden del resultado. */
export function compararResultados(aprobado: ResultadoPrueba, actual: ResultadoPrueba): Diferencia[] {
  const a = aplanar(aprobado);
  const b = aplanar(actual);
  const rutas = [...new Set([...a.keys(), ...b.keys()])];
  const salida: Diferencia[] = [];
  for (const ruta of rutas) {
    const va = a.get(ruta);
    const vb = b.get(ruta);
    if (iguales(va, vb)) continue;
    const ref = (vb ?? va)!;
    salida.push({ ruta, etiqueta: ref.etiqueta, clase: ref.clase, antes: mostrar(va), ahora: mostrar(vb) });
  }
  return salida.sort((x, y) => (x.clase === y.clase ? 0 : x.clase === "entrada" ? -1 : 1));
}

export type EstadoPrueba = "coincide" | "cambio_datos" | "cambio_calculo" | "sin_aprobar";

/**
 * - `coincide`: igual a lo aprobado.
 * - `cambio_datos`: cambió alguna entrada (y quizá el resultado por eso).
 * - `cambio_calculo`: el resultado cambió sin que cambie ninguna entrada.
 */
export function estadoDe(diferencias: Diferencia[] | null): EstadoPrueba {
  if (diferencias === null) return "sin_aprobar";
  if (diferencias.length === 0) return "coincide";
  return diferencias.some((d) => d.clase === "entrada") ? "cambio_datos" : "cambio_calculo";
}
