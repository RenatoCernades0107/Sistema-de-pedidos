import { cn } from "@/lib/utils";

/** Marca los productos que el motor de diseños todavía no dibuja. */
export function SinModelo({ className }: { className?: string }) {
  return (
    <span
      className={cn("text-muted-foreground shrink-0 rounded-full border px-2 py-px text-[11px] font-normal", className)}
      title="Este producto todavía no cuenta con un modelo 3D estándar."
    >
      Sin 3D
    </span>
  );
}
