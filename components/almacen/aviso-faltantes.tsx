import Link from "next/link";
import { ShoppingCart, Truck, TriangleAlert } from "lucide-react";
import type { Almacen } from "@/lib/almacenes";
import { MOTIVOS_FALTANTE, type FaltanteGuardado } from "@/lib/faltantes";
import { cantidad as fmt } from "./comun";

/**
 * En el pedido: el material que le falta donde se produce o se despacha, y si
 * ya viene en camino. Quien gestiona el stock lo resuelve desde "Por mover".
 */
export function AvisoFaltantes({
  faltantes,
  almacenes,
  gestiona,
}: {
  faltantes: FaltanteGuardado[];
  almacenes: Almacen[];
  gestiona: boolean;
}) {
  if (faltantes.length === 0) return null;
  const nombre = (id: string | null) => almacenes.find((a) => a.id === id)?.nombre ?? "otro almacén";
  const pendientes = faltantes.filter((f) => f.estado === "pendiente").length;
  return (
    <section
      className="border-st-observado/25 bg-st-observado-soft flex flex-col gap-2 rounded-xl border p-4 text-sm"
      aria-label="Falta material"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="text-st-observado size-4" />
        {pendientes > 0 ? "Falta material donde se trabaja este pedido" : "El material que faltaba ya viene en camino"}
      </p>
      <ul className="flex flex-col gap-1">
        {faltantes.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-mono">{f.codigo}</span>
            <span>{f.nombre}</span>
            <span>
              · faltan <span className="tnum font-semibold">{fmt(f.cantidad)}</span> en {nombre(f.almacenId)}{" "}
              {MOTIVOS_FALTANTE[f.motivo]}
            </span>
            {f.estado === "en_camino" ? (
              <span className="text-st-en_transito flex items-center gap-1">
                <Truck className="size-3" />
                en camino{f.transferenciaCodigo && ` (${f.transferenciaCodigo})`}
              </span>
            ) : f.origenSugeridoId ? (
              <span className="text-muted-foreground">· traer de {nombre(f.origenSugeridoId)}</span>
            ) : (
              <span className="text-st-observado flex items-center gap-1">
                <ShoppingCart className="size-3" />
                hay que comprar
              </span>
            )}
          </li>
        ))}
      </ul>
      {gestiona && pendientes > 0 && (
        <Link href="/almacen?vista=mover" className="text-primary text-xs font-medium hover:underline">
          Moverlo desde el almacén →
        </Link>
      )}
    </section>
  );
}
