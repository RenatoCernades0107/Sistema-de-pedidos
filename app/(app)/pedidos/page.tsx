import { Suspense } from "react";
import { exigirSesion } from "@/lib/sesion";
import { VistaPedidos } from "@/components/vista-pedidos";

/**
 * La vista de pedidos. Todos los roles entran aquí; lo que cambia es qué pedidos
 * les tocan (`ROLES[rol].base`) y qué filtros de alcance pueden elegir.
 *
 * Un `?ver=` que el rol no tiene no da error: abre con el suyo. Un enlace viejo o
 * compartido entre roles no es un ataque, y la RLS decide igual qué filas llegan.
 * El `Suspense` es el que pide `useSearchParams` para que el build no falle.
 */
export default async function Page() {
  await exigirSesion();
  return (
    <Suspense>
      <VistaPedidos />
    </Suspense>
  );
}
