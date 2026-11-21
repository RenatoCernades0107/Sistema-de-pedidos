/**
 * Lo que Administración ajusta de la lista de precios en `/configuracion`: los
 * teléfonos de la cabecera, la nota del pie y, por cada material o categoría de
 * accesorio, un título y sus notas ("Termoformable", "10 años de garantía").
 *
 * Vive en la fila `lista_precios` de la tabla `configuracion`. Logística también
 * descarga la lista y no puede leer esa tabla: la lee por la función de
 * ventanilla `config_lista_precios()`.
 */

import { z } from "zod";

export const CLAVE_CONFIG_LISTA_PRECIOS = "lista_precios";

export const NOTA_PIE_POR_DEFECTO = "Los precios incluyen IGV.";

const esquemaSeccion = z.object({
  /** Lo que sale como título de la sección. Vacío: el nombre del material o la categoría. */
  titulo: z.string().trim().max(120, "El título es muy largo (máximo 120 caracteres)").default(""),
  /** Una nota por renglón. La primera sale resaltada. */
  nota: z.string().trim().max(800, "La nota es muy larga (máximo 800 caracteres)").default(""),
});

export const esquemaConfigListaPrecios = z.object({
  telefonos: z.string().trim().max(200, "Los teléfonos son muy largos (máximo 200 caracteres)").default(""),
  notaPie: z.string().trim().max(300, "La nota del pie es muy larga (máximo 300 caracteres)").default(NOTA_PIE_POR_DEFECTO),
  /** Por la clave de la sección: `mat:<material>` o `cat:<id de la categoría>`. */
  secciones: z.record(z.string().max(200), esquemaSeccion).default({}),
});

export type ConfigListaPrecios = z.infer<typeof esquemaConfigListaPrecios>;
export type ConfigSeccionLista = z.infer<typeof esquemaSeccion>;

export const CONFIG_LISTA_PRECIOS_DEFECTO: ConfigListaPrecios = {
  telefonos: "",
  notaPie: NOTA_PIE_POR_DEFECTO,
  secciones: {},
};

/** Lo guardado, o el defecto en lo que falte o no se entienda. */
export function leerConfigListaPrecios(json: unknown): ConfigListaPrecios {
  const r = esquemaConfigListaPrecios.safeParse(json ?? {});
  return r.success ? r.data : CONFIG_LISTA_PRECIOS_DEFECTO;
}

/** La clave de la sección de un material o de una categoría de accesorios. */
export const claveMaterial = (material: string) => `mat:${material}`;
export const claveCategoria = (categoriaId: string) => `cat:${categoriaId}`;

/** Las notas de una sección, un renglón cada una, sin los vacíos. */
export const notasDe = (texto: string | undefined) =>
  (texto ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
