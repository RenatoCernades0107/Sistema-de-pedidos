/**
 * Mide cuánto tarda cada tramo de una carga y lo escribe en el log del servidor
 * (en Vercel: Logs del proyecto, buscar `[tiempos]`). Sirve para ver dónde se va
 * el tiempo de una vista —la sesión, una consulta, Odoo— antes de optimizar a
 * ciegas. Una línea por tramo; si molesta, apágalo con `TIEMPOS_LOG=0`.
 */
export async function medir<T>(nombre: string, trabajo: () => PromiseLike<T> | T): Promise<T> {
  if (process.env.TIEMPOS_LOG === "0") return trabajo();
  const inicio = performance.now();
  try {
    return await trabajo();
  } finally {
    console.log(`[tiempos] ${nombre} ${Math.round(performance.now() - inicio)}ms`);
  }
}
