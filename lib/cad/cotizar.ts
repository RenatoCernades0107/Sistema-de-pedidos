/**
 * De un diseño CAD a una línea de cotización: un producto terminado
 * personalizado, con el área de sus piezas y la referencia al diseño y su
 * versión enlazada por clave foránea (`cotizacion_productos.diseno_version_id`).
 *
 * El precio no se pone aquí: lo fija quien cotiza en el editor del producto
 * terminado, que recalcula todo al abrirse con el material real.
 *
 * Puro: lo usan la página de nueva cotización (servidor) y las pruebas.
 */

import { nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import type { LineaTerminado } from "@/lib/lineas-cotizacion";
import { calcularTerminado } from "@/lib/terminados/calcular";

export interface DisenoParaCotizar {
  disenoId: string;
  nombre: string;
  version: number;
  /** `cad_diseno_versiones.id`: lo que guarda la línea. */
  versionId: string;
  /** De la foto del acomodo guardada con la versión. `null` si no hay. */
  areaPiezasMm2: number | null;
  grupo: GrupoPlancha | null;
  color: string | null;
}

const redondear4 = (x: number) =>
  Math.round((x + Number.EPSILON) * 10000) / 10000;

export function lineaDeDiseno(
  d: DisenoParaCotizar,
): Omit<LineaTerminado, "tipo" | "clave"> {
  const areaManualM2 =
    d.areaPiezasMm2 && d.areaPiezasMm2 > 0
      ? Math.max(0.0001, redondear4(d.areaPiezasMm2 / 1e6))
      : null;
  const calculo = calcularTerminado({
    geometria: "manual",
    medidas: {},
    areaManualM2,
    cantidad: 1,
    plancha: null,
    accesorios: [],
    factor: 1,
    extras: [],
    mermaPct: 0,
    anchoDeLetra: 0,
  });
  return {
    productoCodigo: null,
    tipoCodigo: null,
    nombre: d.nombre.trim().slice(0, 160) || "Diseño CAD",
    geometria: "manual",
    medidas: {},
    grupoId: d.grupo?.id ?? null,
    materialTexto: d.grupo ? nombreDeGrupo(d.grupo) : "",
    color: d.color,
    opciones: [],
    opcionesTexto: [],
    texto: "",
    notas: "",
    disenoVersionId: d.versionId,
    areaManualM2,
    accesorios: [],
    cantidad: 1,
    precioUnitario: calculo.precioSugerido,
    reservar: false,
    calculo,
  };
}
