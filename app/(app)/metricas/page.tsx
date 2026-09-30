import { Suspense } from "react";
import { exigirMetricas } from "@/lib/sesion";
import { DashboardMetricas } from "@/components/metricas/dashboard";

/**
 * El dashboard de Administración: ventas, cobranza, cumplimiento y clientes.
 *
 * No es una `Vista`: no filtra pedidos, los resume. Se entra por "Herramientas" y
 * no lee nada propio de la base: calcula sobre los pedidos que ya cargó el layout.
 * El `Suspense` es el que pide `useSearchParams` para que el build no falle.
 */
export default async function Page() {
  await exigirMetricas();
  return (
    <Suspense>
      <DashboardMetricas />
    </Suspense>
  );
}
