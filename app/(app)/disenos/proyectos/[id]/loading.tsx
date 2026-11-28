import { Skeleton } from "@/components/ui/skeleton";

/** La forma de un proyecto mientras llegan sus diseños de Supabase. */
export default function Cargando() {
  return (
    <div className="px-4 py-5 md:px-6 md:py-6" aria-busy>
      <span className="sr-only" role="status">
        Cargando el proyecto…
      </span>

      <Skeleton className="mb-3 h-4 w-20" />
      <div className="mb-5 flex items-end gap-3">
        <div className="flex-1">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    </div>
  );
}
