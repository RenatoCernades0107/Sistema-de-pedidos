import { ChartColumn, MessageSquareText, type LucideIcon } from "lucide-react";

/**
 * El icono de cada herramienta de `lib/dominio.ts`, por `href`, que es lo que la
 * identifica. Aparte de la navegación porque lo leen dos sitios —el shell (barra
 * lateral y menú "Más") y el buscador (⌘K)— y el modelo no sabe de iconos.
 */
export const ICONOS_HERRAMIENTA: Record<string, LucideIcon> = {
  "/cotizaciones": MessageSquareText,
  "/metricas": ChartColumn,
};
