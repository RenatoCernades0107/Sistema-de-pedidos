"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * La red de seguridad de toda la aplicación.
 *
 * Va en la raíz y no dentro de `(app)` a propósito: un `error.tsx` no envuelve
 * al `layout.tsx` de su propio segmento, y quien lee los pedidos de Supabase es
 * justamente el layout de `(app)`. Si esa lectura falla —la base caída, la
 * consulta rechazada— el error sube hasta aquí.
 *
 * En producción Next no manda el mensaje original al navegador para no filtrar
 * detalles del servidor; lo que llega es el `digest`, que sirve para encontrar
 * la traza en los registros. Por eso se muestra: es lo único que se le puede
 * dictar a quien vaya a mirarlo.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold">No se pudo cargar la página</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Casi siempre es la conexión con el servidor. Vuelve a intentarlo; si
          sigue igual, avisa a Administración.
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()} className="gap-1.5">
            <RotateCw className="size-3.5" />
            Reintentar
          </Button>
          <Button variant="outline" render={<a href="/login" />} nativeButton={false}>
            Volver a entrar
          </Button>
        </div>

        {error.digest && (
          <p className="text-muted-foreground mt-4 font-mono text-xs">
            Referencia: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
