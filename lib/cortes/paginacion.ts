/** Cuántas planchas caben por página según el ancho de la pantalla. */
export interface PlanchasPorPagina {
  movil: number;
  escritorio: number;
}

/**
 * Móvil: una plancha por página. Escritorio: 2×2 (cuatro) cuando hay cuatro o más,
 * y de a dos cuando hay dos o tres.
 */
export function planchasPorPaginaDefecto(total: number, ancho: boolean): number {
  if (!ancho) return 1;
  return total >= 4 ? 4 : 2;
}

export interface VentanaDePagina {
  /** Índice (desde 0) de la primera plancha de la página. */
  desde: number;
  /** Índice (desde 0) siguiente a la última plancha de la página. */
  hasta: number;
  /** Página actual, desde 0. */
  pagina: number;
  paginas: number;
}

/**
 * La página que contiene a la plancha `inicio`, con `porPagina` por página.
 *
 * Se parte de un índice y no de un número de página para que, al girar el
 * teléfono o cambiar el tamaño de la ventana, se siga viendo la misma plancha.
 * Si al editar quedan menos planchas, se queda en la última página.
 */
export function ventanaDePagina(total: number, inicio: number, porPagina: number): VentanaDePagina {
  const por = Math.max(1, Math.floor(porPagina));
  const paginas = Math.max(1, Math.ceil(total / por));
  const pagina = Math.min(Math.max(0, Math.floor(inicio / por)), paginas - 1);
  const desde = pagina * por;
  return { desde, hasta: Math.min(total, desde + por), pagina, paginas };
}

/** "Plancha 5 de 75" o "Planchas 5–8 de 75". */
export function rangoDePlanchas(desde: number, hasta: number, total: number): string {
  return hasta - desde <= 1 ? `Plancha ${desde + 1} de ${total}` : `Planchas ${desde + 1}–${hasta} de ${total}`;
}
