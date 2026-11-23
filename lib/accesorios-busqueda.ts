/**
 * Los accesorios por categoría, para "Buscar accesorio": primero la categoría
 * (con cuántos tiene) y después los de esa categoría. Sin dependencias de
 * servidor: lo usan la ruta y su prueba.
 */

export interface CategoriaConAccesorios {
  id: string;
  nombre: string;
  /** Los códigos de Odoo de sus accesorios activos, en orden. */
  codigos: string[];
}

export interface RespuestaAccesorios {
  categorias: CategoriaConAccesorios[];
}

/**
 * Junta cada accesorio activo en su categoría. Las categorías salen en el orden
 * en que llegan (el del Almacén) y las que no tienen ninguno, no salen.
 */
export function categoriasConAccesorios(
  categorias: readonly { id: string; nombre: string }[],
  accesorios: readonly { codigo_odoo: string; categoria_id: string; activo: boolean }[],
): CategoriaConAccesorios[] {
  const porCategoria = new Map<string, Set<string>>();
  for (const a of accesorios) {
    if (!a.activo || !a.codigo_odoo) continue;
    const codigos = porCategoria.get(a.categoria_id) ?? new Set<string>();
    codigos.add(a.codigo_odoo);
    porCategoria.set(a.categoria_id, codigos);
  }
  return categorias
    .map((c) => ({ id: c.id, nombre: c.nombre, codigos: [...(porCategoria.get(c.id) ?? [])] }))
    .filter((c) => c.codigos.length > 0);
}
