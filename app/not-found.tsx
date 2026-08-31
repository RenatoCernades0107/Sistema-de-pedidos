import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Página no encontrada · Plexiacril",
};

/**
 * El 404 manda a la raíz y no a una vista concreta: `/` ya sabe llevar a cada
 * rol a la suya, y el taller no tiene `/admin`.
 */
export default function NoEncontrada() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-1.5 text-lg font-semibold">Esta página no existe</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Puede que el enlace esté viejo. Para buscar un pedido por su código,
          entra y usa el buscador de la cabecera.
        </p>
        <Button
          render={<Link href="/" />}
          nativeButton={false}
          variant="outline"
          className="mt-4"
        >
          Ir a mis pedidos
        </Button>
      </div>
    </main>
  );
}
