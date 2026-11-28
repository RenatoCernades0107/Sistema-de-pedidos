/**
 * El corte conjunto de un proyecto, del lado del servidor: lee sus diseños,
 * vuelve a generar cada uno (con el motor si es de plantilla, con el sandbox si
 * es libre), junta sus piezas y las acomoda en las planchas del catálogo
 * (`lib/cad/proyecto-corte.ts`).
 *
 * Se recalcula cada vez, a propósito: así nunca queda desactualizado respecto a
 * las versiones vigentes y no hay un despiece guardado que mantener. Por eso es
 * una acción a pedido y no parte de la carga de la página.
 *
 * Con la sesión de quien pide: la RLS manda. Quién puede llamar a esto lo
 * comprueban las acciones y el route handler antes.
 */

import { aPlanchasMotor } from "@/lib/cad/acomodo";
import { contornosDeDiseno, obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import { generarDiseno } from "@/lib/cad/motor";
import { obtenerMaterialDiseno, obtenerMaterialesPorCopia } from "@/lib/cad/disenos-servidor";
import { aPlanchasMotorDeGrupos, type PlanchasDeGrupo } from "@/lib/cad/materiales";
import { catalogoParaDiseno } from "@/lib/cad/pagina-servidor";
import { obtenerProyecto } from "@/lib/cad/proyectos-servidor";
import {
  MAX_DISENOS_CORTE,
  cortarProyecto,
  partirId,
  refDeDiseno,
  resumirGrupos,
  type CorteAparteDePieza,
  type DisenoParaCorte,
  type ResumenGrupo,
} from "@/lib/cad/proyecto-corte";
import type { EstadoDiseno } from "@/lib/cad/proyectos";
import { disenoLibreActivo, ejecutarCodigo, type DisenoDeProyecto } from "@/lib/cad/sandbox";
import { PLANTILLA_LIBRE, type PiezaCad, type PlanchaAcomodadaCad } from "@/lib/cad/tipos";

/** Cuántos diseños se regeneran a la vez. */
const CONCURRENCIA = 4;

/** Lo que la pantalla necesita del corte conjunto (sin coordenadas: pesan y no se dibujan todavía). */
export type CorteProyectoVista = {
  proyecto: { id: string; nombre: string };
  disenos: { ref: string; id: string; nombre: string; estado: EstadoDiseno }[];
  grupos: ResumenGrupo[];
  /** Lo que se corta aparte (MDF…), por diseño. */
  corteAparte: { ref: string; disenoId: string; disenoNombre: string; piezaId: string; nombre: string; copias: number; material: string; espesorMm: number; solo: Record<string, number[]> }[];
  /** Lo que impide cortar: con cualquiera, no se baja nada. */
  problemas: string[];
  /** Lo que conviene saber pero no impide cortar. */
  avisos: string[];
  /** Hay algo que acomodar y nada lo impide. */
  listo: boolean;
};

/** Lo que el DXF necesita además de la vista. */
export type CorteProyectoCalculado = {
  vista: CorteProyectoVista;
  grupos: PlanchasDeGrupo[];
  /** Los diseños tal como los pide el sandbox, por su `ref`. */
  disenosDxf: Map<string, DisenoDeProyecto>;
  kerfMm: number;
};

/** Hace `tarea` con cada elemento, `limite` a la vez, conservando el orden. */
async function conLimite<T, R>(elementos: readonly T[], limite: number, tarea: (e: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(elementos.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      salida[i] = await tarea(elementos[i]);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

const motivo = (e: unknown) => (e instanceof Error ? e.message : "falló la generación");

/**
 * El corte conjunto del proyecto. `null` si no existe o no se puede ver. Los diseños
 * que no están listos para cortar (sin versión, personalizados sin aprobar, sin
 * material) no se acomodan: quedan como `problemas` y no se baja nada hasta resolverlos.
 */
export async function calcularCorteProyecto(proyectoId: string): Promise<CorteProyectoCalculado | null> {
  const proyecto = await obtenerProyecto(proyectoId);
  if (!proyecto) return null;

  const problemas: string[] = [];
  const disenos = proyecto.disenos;
  if (disenos.length === 0) problemas.push("El proyecto no tiene diseños.");
  if (disenos.length > MAX_DISENOS_CORTE) {
    problemas.push(`El corte conjunto admite hasta ${MAX_DISENOS_CORTE} diseños y este tiene ${disenos.length}.`);
  }
  const vista: CorteProyectoVista["disenos"] = disenos.map((d, i) => ({ ref: refDeDiseno(i), id: d.id, nombre: d.nombre, estado: d.estado }));

  // Lo que no se puede cortar todavía, dicho por diseño.
  const listos = disenos.slice(0, MAX_DISENOS_CORTE).flatMap((d, i) => {
    if (d.estado === "sin_version") {
      problemas.push(`«${d.nombre}» todavía no tiene diseño: ábrelo y pídele al asistente que lo arme.`);
      return [];
    }
    if (d.estado === "borrador") {
      problemas.push(`«${d.nombre}» es un diseño personalizado sin aprobar: Administración tiene que aprobarlo antes del corte.`);
      return [];
    }
    if (d.plantilla === PLANTILLA_LIBRE && !disenoLibreActivo()) {
      problemas.push(`«${d.nombre}» es un diseño personalizado y el diseño libre no está disponible ahora.`);
      return [];
    }
    return [{ d, ref: refDeDiseno(i) }];
  });

  const catalogo = await catalogoParaDiseno(false);
  if (catalogo.grupos.length === 0) problemas.push("No se pudo leer el catálogo de planchas.");

  // Regenerar cada diseño: piezas, material y, si es libre, su código y sus contornos.
  const generados = await conLimite(listos, CONCURRENCIA, async ({ d, ref }) => {
    try {
      const [material, porCopia] = await Promise.all([obtenerMaterialDiseno(d.id), obtenerMaterialesPorCopia(d.id)]);
      let piezas: PiezaCad[];
      let dxf: DisenoDeProyecto;
      if (d.plantilla === PLANTILLA_LIBRE) {
        const libre = await obtenerVersionLibre(d.id);
        if (!libre) throw new Error("no tiene una versión personalizada vigente");
        const contornos = await contornosDeDiseno(d.id);
        piezas = (await ejecutarCodigo(libre.codigo, contornos)).piezas ?? [];
        dxf = { ref, nombre: d.nombre, codigo: libre.codigo, contornos };
      } else {
        const g = await generarDiseno(d.plantilla!, d.parametros);
        piezas = g.piezas ?? [];
        dxf = { ref, nombre: d.nombre, plantilla: d.plantilla!, parametros: g.parametros };
      }
      const paraCorte: DisenoParaCorte = { ref, nombre: d.nombre, piezas, material, porCopia, parametros: d.parametros };
      return { ok: true as const, paraCorte, dxf };
    } catch (e) {
      return { ok: false as const, error: `«${d.nombre}»: ${motivo(e)}` };
    }
  });
  for (const g of generados) if (!g.ok) problemas.push(g.error);

  const paraCorte = generados.flatMap((g) => (g.ok ? [g.paraCorte] : []));
  const disenosDxf = new Map(generados.flatMap((g) => (g.ok ? [[g.dxf.ref, g.dxf] as const] : [])));

  const corte = { kerfMm: catalogo.kerfMm, margenMm: catalogo.margenMm };
  const r = paraCorte.length
    ? cortarProyecto({ disenos: paraCorte, catalogo: catalogo.grupos, corte, sugerencia: { politica: catalogo.politica } })
    : { grupos: [] as PlanchasDeGrupo[], corteAparte: [] as CorteAparteDePieza[], problemas: [] as string[], avisos: [] as string[] };
  problemas.push(...r.problemas);

  const porRef = new Map(vista.map((v) => [v.ref, v]));
  const corteAparte = r.corteAparte.map((c) => ({
    ref: c.ref,
    disenoId: porRef.get(c.ref)?.id ?? "",
    disenoNombre: porRef.get(c.ref)?.nombre ?? c.ref,
    piezaId: c.piezaId,
    nombre: c.nombre,
    copias: c.indices.length,
    material: c.material,
    espesorMm: c.espesorMm,
    solo: { [c.piezaId]: [...c.indices].sort((a, b) => a - b) },
  }));

  return {
    vista: {
      proyecto: { id: proyecto.id, nombre: proyecto.nombre },
      disenos: vista,
      grupos: resumirGrupos(r.grupos),
      corteAparte,
      problemas,
      avisos: r.avisos,
      listo: problemas.length === 0 && r.grupos.length > 0,
    },
    grupos: r.grupos,
    disenosDxf,
    kerfMm: catalogo.kerfMm,
  };
}

/**
 * Las planchas del corte (todas, o solo las del grupo `clave`) tal como las pide el
 * sandbox, y los diseños que tienen piezas en ellas.
 */
export function planchasParaDxfProyecto(
  corte: CorteProyectoCalculado,
  clave?: string,
): { planchas: PlanchaAcomodadaCad[]; disenos: DisenoDeProyecto[] } | null {
  const grupos = clave ? corte.grupos.filter((g) => g.clave === clave) : corte.grupos;
  const planchas = aPlanchasMotorDeGrupos(grupos, aPlanchasMotor);
  if (planchas.length === 0) return null;
  const refs = new Set(planchas.flatMap((p) => p.piezas.map((x) => partirId(x.id)?.ref).filter((r): r is string => !!r)));
  const disenos = [...corte.disenosDxf.values()].filter((d) => refs.has(d.ref));
  return { planchas, disenos };
}
