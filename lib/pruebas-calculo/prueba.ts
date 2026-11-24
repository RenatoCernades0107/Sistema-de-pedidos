/**
 * Las pruebas de cálculo de `/configuracion` (pestaña «Pruebas de cálculo»):
 * un caso por tipo de producto terminado con modelo CAD (caja, letrero,
 * letras), calculado con la base, el motor, los precios de Odoo y la
 * configuración reales, por el mismo camino que el diseñador de terminados:
 *
 *   producto del catálogo + medida + plancha  → parámetros (`parametrosCadDe`)
 *   motor CAD                                 → piezas
 *   `planchasDelDiseno`                       → acomodo en planchas
 *   `costoPorGrupos` (`costoDiseno`)          → material + láser = total
 *   total ÷ unidades × factor del tipo        → precio sugerido por unidad
 *
 * El resultado lleva también las entradas que se usaron (precios, tabla del
 * láser, kerf…), para que quien revisa vea de dónde salió cada número y, al
 * compararlo con el aprobado (`comparar.ts`), si lo que cambió es un dato o el
 * cálculo.
 *
 * Puro: lo usan el servidor y las pruebas.
 */

import { z } from "zod";
import { nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { parametrosLaser } from "@/lib/cortes/laser";
import { costoDiseno } from "@/lib/cad/costo";
import { costoPorGrupos, planchasDelDiseno } from "@/lib/cad/materiales";
import type { ParametrosCad, ResultadoGeneracion } from "@/lib/cad/tipos";
import {
  espesorRecomendado,
  medidasDe,
  textoDeMedidaEstandar,
  type CatalogoTerminados,
  type MedidaEstandar,
  type ProductoEstandar,
} from "@/lib/terminados/catalogo";
import { parametrosCadDe } from "@/lib/terminados/plantilla-cad";

/** Los tipos que se prueban: el código de su plantilla CAD. */
export const TIPOS_PRUEBA = ["caja", "letrero", "letras"] as const;
export type TipoPrueba = (typeof TIPOS_PRUEBA)[number];

export const NOMBRES_PRUEBA: Record<TipoPrueba, string> = {
  caja: "Caja",
  letrero: "Letrero",
  letras: "Letras",
};

/** Los que llevan texto. */
export const LLEVA_TEXTO: Record<TipoPrueba, boolean> = { caja: false, letrero: true, letras: true };
export const TEXTO_POR_DEFECTO = "ACRILICO";

export const CLAVE_PRUEBAS_CALCULO = "pruebas_calculo";

export const esquemaCaso = z.object({
  tipo: z.enum(TIPOS_PRUEBA),
  productoCodigo: z.string().min(1).max(40),
  medidaId: z.string().min(1).max(80),
  grupoPlanchaId: z.string().min(1).max(80),
  texto: z.string().max(60),
  unidades: z.coerce.number().int().min(1).max(500),
});

export type CasoPrueba = z.infer<typeof esquemaCaso>;

export interface PiezaPrueba {
  id: string;
  nombre: string;
  cantidad: number;
  espesorMm: number;
  anchoMm: number;
  altoMm: number;
  areaMm2: number;
  perimetroMm: number;
}

export interface GrupoPrueba {
  etiqueta: string;
  /** "PL-001 (122 × 183 cm)". `null`: no hubo acomodo. */
  formato: string | null;
  /** Planchas cobradas, con fracciones. */
  planchas: number;
  /** Planchas físicas que usa el acomodo. */
  planchasAcomodo: number;
  usoPct: number;
  mermaPct: number;
  noCaben: number;
  material: number;
  minutosLaser: number;
  servicio: number;
  total: number;
  problema: string | null;
}

export interface ResultadoPrueba {
  ejecutadoEn: string;
  producto: { codigo: string; nombre: string; tipo: string; factor: number };
  medida: string;
  plancha: string;
  unidades: number;
  texto: string | null;
  entradas: {
    plantilla: string;
    versionPlantilla: number;
    /** Los que se mandaron al motor. */
    parametrosEnviados: ParametrosCad;
    /** Los que devolvió el motor, ya con sus valores por defecto. */
    parametros: ParametrosCad;
    kerfMm: number;
    margenMm: number;
    laser: {
      espesorMm: number;
      velocidad: number;
      pierce: number;
      pasadas: number;
      factorVelocidad: number;
      overheadPorPieza: number;
      costoPorMinuto: number;
      igvPct: number;
    };
    redondearAlSol: boolean;
    /** «1/2 (+10 %)»: las fracciones de plancha que se cobran. */
    fracciones: string[];
    /** El precio de Odoo de cada formato del material. `null`: Odoo no lo tiene. */
    precios: { codigo: string; medida: string; precio: number | null }[];
  };
  piezas: PiezaPrueba[];
  validaciones: { nivel: "error" | "aviso"; mensaje: string }[];
  grupos: GrupoPrueba[];
  /** Lo que impide cortarlo o cobrarlo tal cual. */
  problemas: string[];
  totales: {
    planchas: number;
    material: number;
    minutosLaser: number;
    servicio: number;
    total: number;
    costoUnidad: number;
    sugeridoUnidad: number;
  } | null;
}

export type Ejecucion = { ok: true; resultado: ResultadoPrueba } | { ok: false; error: string };

export interface PruebaAprobada {
  caso: CasoPrueba;
  resultado: ResultadoPrueba;
  aprobadoEn: string;
  aprobadoPor: string;
}

export type PruebasGuardadas = Partial<Record<TipoPrueba, PruebaAprobada>>;

const esquemaAprobada = z.object({
  caso: esquemaCaso,
  // El resultado lo arma el servidor: basta con que tenga su forma general.
  resultado: z.looseObject({
    producto: z.looseObject({ codigo: z.string() }),
    entradas: z.looseObject({ precios: z.array(z.unknown()) }),
    piezas: z.array(z.unknown()),
    grupos: z.array(z.unknown()),
  }),
  aprobadoEn: z.string(),
  aprobadoPor: z.string(),
});

/** Lo guardado en `configuracion.pruebas_calculo`. Lo que no sirva se ignora: nunca falla. */
export function leerPruebasGuardadas(json: unknown): PruebasGuardadas {
  const o = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const salida: PruebasGuardadas = {};
  for (const tipo of TIPOS_PRUEBA) {
    const r = esquemaAprobada.safeParse(o[tipo]);
    if (r.success && r.data.caso.tipo === tipo) salida[tipo] = r.data as unknown as PruebaAprobada;
  }
  return salida;
}

/* ── El caso por defecto ───────────────────────────────────────────────────── */

const porOrden = <T extends { orden: number }>(xs: T[]) => [...xs].sort((a, b) => a.orden - b.orden);

/** Los productos activos que dibuja la plantilla del tipo. */
export const productosDeTipo = (catalogo: Pick<CatalogoTerminados, "productos">, tipo: TipoPrueba) =>
  catalogo.productos
    .filter((p) => p.activo && p.plantillaCad === tipo && p.medidas.length > 0)
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

/** Los grupos de plancha que sirven: con algún formato activo. */
export const gruposUtiles = (grupos: readonly GrupoPlancha[]) =>
  grupos.filter((g) => g.formatos.some((f) => f.activo));

/**
 * La plancha por defecto de un producto: la primera del catálogo en un espesor
 * recomendado para él; si no hay, la del espesor de sus parámetros; si no, la
 * primera con formatos.
 */
export function planchaPorDefecto(
  producto: Pick<ProductoEstandar, "espesores" | "parametrosCad">,
  grupos: readonly GrupoPlancha[],
): GrupoPlancha | null {
  const utiles = gruposUtiles(grupos);
  const espesor = producto.parametrosCad?.espesor;
  return (
    utiles.find((g) => espesorRecomendado(producto, g.espesorMm)) ??
    (typeof espesor === "number" ? utiles.find((g) => Math.abs(g.espesorMm - espesor) < 1e-6) : undefined) ??
    utiles[0] ??
    null
  );
}

/** El caso con el que arranca cada tipo. `null` si el catálogo no tiene con qué. */
export function casoPorDefecto(
  tipo: TipoPrueba,
  catalogo: Pick<CatalogoTerminados, "productos">,
  grupos: readonly GrupoPlancha[],
): CasoPrueba | null {
  const producto = productosDeTipo(catalogo, tipo)[0];
  if (!producto) return null;
  const medida = porOrden(producto.medidas)[0];
  const grupo = planchaPorDefecto(producto, grupos);
  if (!medida || !grupo) return null;
  return {
    tipo,
    productoCodigo: producto.codigo,
    medidaId: medida.id,
    grupoPlanchaId: grupo.id,
    texto: LLEVA_TEXTO[tipo] ? TEXTO_POR_DEFECTO : "",
    unidades: 1,
  };
}

/* ── Del caso a los parámetros del motor ───────────────────────────────────── */

export interface CasoResuelto {
  producto: ProductoEstandar;
  medida: MedidaEstandar;
  grupo: GrupoPlancha;
  factor: number;
  parametros: ParametrosCad;
}

/** El producto, la medida y la plancha del caso, y lo que se le pide al motor. */
export function resolverCaso(
  caso: CasoPrueba,
  catalogo: Pick<CatalogoTerminados, "productos" | "tipos">,
  grupos: readonly GrupoPlancha[],
): { ok: true; resuelto: CasoResuelto } | { ok: false; error: string } {
  const producto = catalogo.productos.find((p) => p.codigo === caso.productoCodigo);
  if (!producto) return { ok: false, error: `El producto ${caso.productoCodigo} ya no está en el catálogo.` };
  if (producto.plantillaCad !== caso.tipo) {
    return { ok: false, error: `El producto ${producto.codigo} ya no usa la plantilla «${caso.tipo}».` };
  }
  const medida = producto.medidas.find((m) => m.id === caso.medidaId);
  if (!medida) return { ok: false, error: `La medida elegida ya no está en ${producto.codigo}.` };
  const grupo = grupos.find((g) => g.id === caso.grupoPlanchaId);
  if (!grupo) return { ok: false, error: "La plancha elegida ya no está en el catálogo (o está inactiva)." };
  const factor = catalogo.tipos.find((t) => t.codigo === producto.tipo)?.factor ?? 1;
  const parametros = parametrosCadDe(producto, medidasDe(medida), {
    espesorMm: grupo.espesorMm,
    texto: LLEVA_TEXTO[caso.tipo] ? caso.texto : null,
  });
  if (!parametros) return { ok: false, error: `El producto ${producto.codigo} no tiene modelo CAD.` };
  return { ok: true, resuelto: { producto, medida, grupo, factor, parametros } };
}

/* ── Del motor al resultado ────────────────────────────────────────────────── */

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = (x: number) => Math.round((x + Number.EPSILON) * 10000) / 10000;
const medidaFormato = (f: { anchoCm: number; largoCm: number }) => `${+f.anchoCm.toFixed(2)} × ${+f.largoCm.toFixed(2)} cm`;

/**
 * El resultado de una prueba: el despiece del motor acomodado y costeado con
 * las mismas funciones que la pantalla de diseño.
 */
export function armarResultado(entrada: {
  caso: CasoPrueba;
  resuelto: CasoResuelto;
  generacion: Pick<ResultadoGeneracion, "plantilla" | "version_plantilla" | "parametros" | "piezas" | "validaciones">;
  catalogo: readonly GrupoPlancha[];
  config: ConfigCortes;
  /** Precio de Odoo por código de plancha. */
  precios: Readonly<Record<string, number>>;
  ahora?: Date;
}): ResultadoPrueba {
  const { caso, resuelto, generacion, catalogo, config, precios } = entrada;
  const { producto, medida, grupo, factor } = resuelto;
  const unidades = Math.max(1, Math.floor(caso.unidades));
  const kerfMm = config.corte.kerfLaser * 10;
  const margenMm = config.corte.margen * 10;

  const planchas = planchasDelDiseno({
    catalogo,
    porDefecto: { grupoPlanchaId: grupo.id, color: null },
    porCopia: {},
    parametros: generacion.parametros,
    piezas: generacion.piezas,
    corte: { kerfMm, margenMm },
    unidades,
  });
  const costo = costoPorGrupos(planchas.grupos, costoDiseno, { precios, config });

  const grupos: GrupoPrueba[] = planchas.grupos.map((g, i) => {
    const c = costo?.grupos[i]?.costo ?? null;
    const a = g.acomodo;
    const f = a ? g.grupo.formatos.find((x) => x.id === a.formatoId) : undefined;
    const areaPlanchas = a?.areaPlanchasMm2 ?? 0;
    return {
      etiqueta: g.etiqueta,
      formato: f ? `${f.codigo} (${medidaFormato(f)})` : null,
      planchas: r4(c?.planchas ?? 0),
      planchasAcomodo: a?.planchas.length ?? 0,
      usoPct: a && areaPlanchas > 0 ? r2((a.areaPiezasMm2 / areaPlanchas) * 100) : 0,
      mermaPct: a ? r2(a.mermaPct) : 0,
      noCaben: a?.noCaben.length ?? 0,
      material: r2(c?.material ?? 0),
      minutosLaser: r2(c?.minutosLaser ?? 0),
      servicio: r2(c?.servicio ?? 0),
      total: r2(c?.total ?? 0),
      problema: c?.problema ?? (c ? null : "Sin costo: no hubo acomodo en este material."),
    };
  });

  const problemas = [...planchas.problemas];
  if (costo?.problema && !problemas.includes(costo.problema)) problemas.push(costo.problema);
  if (planchas.grupos.length === 0) problemas.push("Ninguna pieza quedó en una plancha del catálogo.");

  const fila = parametrosLaser(config.laser.tabla, grupo.espesorMm);
  const usados = new Set(planchas.grupos.map((g) => g.grupo.id));
  usados.add(grupo.id);
  const preciosUsados = catalogo
    .filter((g) => usados.has(g.id))
    .flatMap((g) => g.formatos.filter((f) => f.activo))
    .filter((f, i, xs) => xs.findIndex((y) => y.codigo === f.codigo) === i)
    .map((f) => ({ codigo: f.codigo, medida: medidaFormato(f), precio: precios[f.codigo] ?? null }));

  const costoUnidad = costo ? r2(costo.total / unidades) : 0;
  return {
    ejecutadoEn: (entrada.ahora ?? new Date()).toISOString(),
    producto: { codigo: producto.codigo, nombre: producto.nombre, tipo: producto.tipo, factor },
    medida: textoDeMedidaEstandar(medida),
    plancha: nombreDeGrupo(grupo),
    unidades,
    texto: typeof generacion.parametros.texto === "string" ? generacion.parametros.texto : null,
    entradas: {
      plantilla: generacion.plantilla,
      versionPlantilla: generacion.version_plantilla,
      parametrosEnviados: resuelto.parametros,
      parametros: generacion.parametros,
      kerfMm: r4(kerfMm),
      margenMm: r4(margenMm),
      laser: {
        espesorMm: grupo.espesorMm,
        velocidad: r4(fila.velocidad),
        pierce: r4(fila.pierce),
        pasadas: fila.pasadas,
        factorVelocidad: config.laser.factorVelocidad,
        overheadPorPieza: config.laser.overheadPorPieza,
        costoPorMinuto: config.laser.costoPorMinuto,
        igvPct: config.laser.igvPct,
      },
      redondearAlSol: config.cobro.redondearAlSol,
      fracciones: config.cobro.fracciones.map((f) => `${f.nombre} (+${+f.recargoPct.toFixed(2)} %)`),
      precios: preciosUsados,
    },
    piezas: generacion.piezas.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      cantidad: p.cantidad,
      espesorMm: p.espesor_mm,
      anchoMm: r2(p.ancho_mm),
      altoMm: r2(p.alto_mm),
      areaMm2: r2(p.area_mm2),
      perimetroMm: r2(p.perimetro_mm),
    })),
    validaciones: generacion.validaciones.map((v) => ({ nivel: v.nivel, mensaje: v.mensaje })),
    grupos,
    problemas,
    totales: costo
      ? {
          planchas: r4(costo.planchas),
          material: r2(costo.material),
          minutosLaser: r2(costo.minutosLaser),
          servicio: r2(costo.servicio),
          total: r2(costo.total),
          costoUnidad,
          sugeridoUnidad: r2(costoUnidad * (factor > 0 ? factor : 1)),
        }
      : null,
  };
}
