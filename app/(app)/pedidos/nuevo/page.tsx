import { exigirCrearPedido } from "@/lib/sesion";
import { NuevoPedidoForm } from "@/components/nuevo-pedido-form";

export default async function Page() {
  await exigirCrearPedido();
  return <NuevoPedidoForm />;
}
