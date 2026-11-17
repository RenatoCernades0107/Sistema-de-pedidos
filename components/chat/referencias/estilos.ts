import { Box, Layers, Package, UserRound, Users, type LucideIcon } from "lucide-react";
import type { TipoReferencia } from "@/lib/chat/tipos";

/**
 * Un icono y un color sutil por tipo de referencia: en el campo, en el menú y
 * en el mensaje se reconoce de un vistazo qué es cada ficha.
 */
export const ICONO_REFERENCIA: Record<TipoReferencia, LucideIcon> = {
  cliente: Users,
  pedido: Package,
  plancha: Layers,
  diseno: Box,
  usuario: UserRound,
};

/** El resaltado detrás del texto del campo (el texto lo pinta el textarea encima). */
export const FONDO_CAMPO: Record<TipoReferencia, string> = {
  cliente: "bg-sky-500/20",
  pedido: "bg-amber-500/25",
  plancha: "bg-emerald-500/20",
  diseno: "bg-violet-500/20",
  usuario: "bg-rose-500/20",
};

/** La ficha dentro de una burbuja ajena (fondo neutro). */
export const FICHA_TEXTO: Record<TipoReferencia, string> = {
  cliente: "bg-sky-500/12 text-sky-800 hover:bg-sky-500/20 dark:text-sky-300",
  pedido: "bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 dark:text-amber-300",
  plancha: "bg-emerald-500/12 text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-300",
  diseno: "bg-violet-500/12 text-violet-800 hover:bg-violet-500/20 dark:text-violet-300",
  usuario: "bg-rose-500/12 text-rose-800 hover:bg-rose-500/20 dark:text-rose-300",
};

/**
 * Dentro de la burbuja propia (`bg-primary`) los colores de arriba no se leen:
 * la ficha va en el color del texto de la burbuja, con un fondo apenas más claro.
 */
export const FICHA_PROPIA = "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25";

/** El icono del menú. */
export const ICONO_MENU: Record<TipoReferencia, string> = {
  cliente: "text-sky-600 dark:text-sky-400",
  pedido: "text-amber-600 dark:text-amber-400",
  plancha: "text-emerald-600 dark:text-emerald-400",
  diseno: "text-violet-600 dark:text-violet-400",
  usuario: "text-rose-600 dark:text-rose-400",
};
