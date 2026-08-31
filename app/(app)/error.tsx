"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Falla una vista, no la aplicación: este límite está por debajo del layout de
 * `(app)`, así que la cabecera y el menú siguen en pie y se puede saltar a otra
 * vista sin recargar. Lo que se cae en el propio layout lo recoge
 * `app/error.tsx`.
 */
export default function ErrorDeVista({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div className="max-w-sm">
        <TriangleAlert className="text-st-observado mx-auto size-5" aria-hidden />
        <h1 className="mt-2 text-lg font-semibold">Esta vista no se pudo mostrar</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          El resto de la aplicación sigue funcionando: prueba otra vista o
          vuelve a intentarlo aquí.
        </p>
        <Button onClick={() => retry()} className="mt-4 gap-1.5">
          <RotateCw className="size-3.5" />
          Reintentar
        </Button>
        {error.digest && (
          <p className="text-muted-foreground mt-4 font-mono text-xs">
            Referencia: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
