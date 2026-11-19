import { Suspense } from "react";
import { exigirSesion } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarBorradores } from "@/lib/borradores-servidor";
import { ListaBorradores } from "@/components/borradores/lista-borradores";
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
  const perfil = await exigirSesion();
  // Los pedidos a medio llenar de quien mira (solo si puede crear pedidos).
  const borradores = ROLES[perfil.rol].crearPedido ? await cargarBorradores("pedido") : [];
  return (
    <Suspense>
      <VistaPedidos borradores={<ListaBorradores borradores={borradores} nombre="pedido" />} />
    </Suspense>
  );
}
