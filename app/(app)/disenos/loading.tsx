import { Skeleton } from "@/components/ui/skeleton";

/** La forma de la lista de diseños mientras llegan de Supabase. */
export default function Cargando() {
  return (
    <div className="px-4 py-5 md:px-6 md:py-6" aria-busy>
      <span className="sr-only" role="status">
        Cargando diseños…
      </span>

      <div className="mb-5 flex items-end gap-3">
        <div className="flex-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
