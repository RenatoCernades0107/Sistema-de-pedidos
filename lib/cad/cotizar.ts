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

/** Lo que el pedido ya sabe al agregar: cuántas, a cuánto y de qué tipo. */
export interface ExtrasLineaDiseno {
  cantidad?: number;
  /** `null` o sin dar: el sugerido. */
  precioUnitario?: number | null;
  nombre?: string | null;
  tipoCodigo?: string | null;
}

export function lineaDeDiseno(
  d: DisenoParaCotizar,
  extras: ExtrasLineaDiseno = {},
): Omit<LineaTerminado, "tipo" | "clave"> {
  const cantidad = extras.cantidad && extras.cantidad > 0 ? Math.floor(extras.cantidad) : 1;
  const areaManualM2 =
    d.areaPiezasMm2 && d.areaPiezasMm2 > 0
      ? Math.max(0.0001, redondear4(d.areaPiezasMm2 / 1e6))
      : null;
  const calculo = calcularTerminado({
    geometria: "manual",
    medidas: {},
    areaManualM2,
    cantidad,
    plancha: null,
    accesorios: [],
    factor: 1,
    extras: [],
    mermaPct: 0,
    anchoDeLetra: 0,
  });
  return {
    productoCodigo: null,
    tipoCodigo: extras.tipoCodigo ?? null,
    nombre: (extras.nombre ?? d.nombre).trim().slice(0, 160) || "Diseño CAD",
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
    cantidad,
    precioUnitario:
      typeof extras.precioUnitario === "number" && extras.precioUnitario >= 0
        ? Math.round(extras.precioUnitario * 100) / 100
        : calculo.precioSugerido,
    reservar: false,
    calculo,
  };
}
