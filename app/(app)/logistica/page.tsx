import { exigirVista } from "@/lib/sesion";
import { VistaPedidos } from "@/components/vista-pedidos";

export default async function Page() {
  await exigirVista("logistica");
  return <VistaPedidos vista="logistica" />;
}
