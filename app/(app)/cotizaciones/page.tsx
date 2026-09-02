import { exigirAgenteCotizacion } from "@/lib/sesion";
import { VistaCotizaciones } from "@/components/cotizaciones/vista-cotizaciones";
import { listarChats } from "./acciones";

export default async function Page() {
  await exigirAgenteCotizacion();
  const chats = await listarChats();
  return <VistaCotizaciones chatsIniciales={chats.ok ? chats.data : []} />;
}
