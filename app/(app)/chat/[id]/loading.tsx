import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mientras llega otra conversación. Sin esto, al tocar una de la lista la de
 * antes se queda quieta hasta que responde el servidor y parece que no pasó nada.
 */
export default function Cargando() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy>
      <span className="sr-only" role="status">
        Abriendo la conversación…
      </span>
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 p-4">
        <Skeleton className="h-9 w-2/3 rounded-2xl" />
        <Skeleton className="h-9 w-1/2 self-end rounded-2xl" />
        <Skeleton className="h-16 w-3/5 rounded-2xl" />
      </div>
      <div className="border-t p-3">
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
