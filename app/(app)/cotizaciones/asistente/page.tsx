import { exigirAgenteCotizacion } from "@/lib/sesion";
import { VistaCotizaciones } from "@/components/cotizaciones/vista-cotizaciones";
import { listarChats } from "./acciones";

/**
 * El chat con el asistente de cotizaciones. Antes era `/cotizaciones`; ahora esa
 * ruta es la lista, y lo que el asistente crea en Odoo se registra allí también.
 *
 * `?chat=<id>` abre ese chat al llegar: es el enlace "Ver chat" del detalle.
 */
export default async function Page({ searchParams }: PageProps<"/cotizaciones/asistente">) {
  await exigirAgenteCotizacion();
  const [chats, { chat }] = await Promise.all([listarChats(), searchParams]);
  return (
    <VistaCotizaciones
      chatsIniciales={chats.ok ? chats.data : []}
      chatInicial={typeof chat === "string" && chat ? chat : null}
    />
  );
}
