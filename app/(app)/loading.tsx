import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lo que se ve mientras el layout de `(app)` pide los pedidos a Supabase. No
 * imita la lista fila por fila —eso mentiría sobre cuántas hay—: da la forma de
 * la página para que el salto al contenido real no mueva todo de sitio.
 */
export default function Cargando() {
  return (
    <div className="px-4 py-5 md:px-6 md:py-6" aria-busy>
      <span className="sr-only" role="status">
        Cargando pedidos…
      </span>

      <Skeleton className="h-6 w-44" />
      <Skeleton className="mt-2 h-4 w-64" />

      <div className="mt-5 flex gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
