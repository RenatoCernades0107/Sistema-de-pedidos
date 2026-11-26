import { Box, ChartColumn, Calculator, ShoppingCart, MessageCircle, MessageSquareText, Settings, Warehouse, type LucideIcon } from "lucide-react";

/**
 * El icono de cada herramienta de `lib/dominio.ts`, por `href`, que es lo que la
 * identifica. Aparte de la navegación porque lo leen dos sitios —el shell (barra
 * lateral y menú "Más") y el buscador (⌘K)— y el modelo no sabe de iconos.
 */
export const ICONOS_HERRAMIENTA: Record<string, LucideIcon> = {
  "/chat": MessageCircle,
  "/cotizaciones": MessageSquareText,
  "/disenos": Box,
  "/almacen": Warehouse,
  "/compras": ShoppingCart,
  "/costos-precios": Calculator,
  "/metricas": ChartColumn,
  "/configuracion": Settings,
};
