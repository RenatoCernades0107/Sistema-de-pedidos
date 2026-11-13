import { Skeleton } from "@/components/ui/skeleton";

/** La pantalla partida, vacía: chat a la izquierda y render a la derecha. */
export default function Cargando() {
  return (
    <div
      className="flex h-[calc(100dvh-3.5rem-1px-5rem)] min-h-0 flex-col md:h-[calc(100dvh-3.5rem-1px)]"
      aria-busy
    >
      <span className="sr-only" role="status">
        Cargando el diseño…
      </span>
      <div className="border-b px-3 py-2">
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 flex-col gap-3 p-4 md:border-r">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="mt-auto h-20 w-full" />
        </div>
        <div className="hidden flex-1 flex-col md:flex">
          <Skeleton className="h-[42%] w-full rounded-none" />
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
