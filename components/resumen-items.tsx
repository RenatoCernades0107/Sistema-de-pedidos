import { cn } from "@/lib/utils";
import { textoItem, type ItemPedido } from "@/lib/dominio";

/**
 * Lo que lleva un pedido en una sola línea: el primer ítem, truncado si no cabe,
 * y cuántos más hay, que no se trunca nunca. La lista completa va en el título.
 */
export function ResumenItems({ items, className }: { items: ItemPedido[]; className?: string }) {
  if (items.length === 0) return <span className={cn("text-muted-foreground", className)}>Sin ítems</span>;
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)} title={items.map(textoItem).join("\n")}>
      <span className="tnum truncate">{textoItem(items[0])}</span>
      {items.length > 1 && <span className="text-muted-foreground shrink-0 font-medium">+{items.length - 1}</span>}
    </span>
  );
}
