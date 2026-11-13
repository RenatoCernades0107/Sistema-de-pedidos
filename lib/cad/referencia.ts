/**
 * El diseño CAD del que sale una línea de cotización o de pedido.
 *
 * La línea lo guarda por clave foránea (`cotizacion_productos.diseno_version_id`
 * → `cad_diseno_versiones`), así que el diseño no se puede borrar mientras haya
 * una cotización que lo use. `lineas_de_pedido()` lo devuelve ya resuelto.
 */

export interface ReferenciaDiseno {
  disenoId: string;
  version: number;
}
