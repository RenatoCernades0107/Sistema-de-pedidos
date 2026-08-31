import { exigirVista } from "@/lib/sesion";
import { VistaPedidos } from "@/components/vista-pedidos";

export default async function Page() {
  await exigirVista("tienda");
  return <VistaPedidos vista="tienda" />;
}
