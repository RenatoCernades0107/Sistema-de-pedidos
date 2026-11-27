import Link from "next/link";
import { exigirConversaciones } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarAjustesAgente } from "@/lib/agente-whatsapp/contexto-servidor";
import { esEstadoConversacion } from "@/lib/agente-whatsapp/estado";
import { cargarConversaciones } from "@/lib/agente-whatsapp/pruebas-servidor";
import { Conversaciones } from "@/components/agente-whatsapp/conversaciones";

/**
 * Las conversaciones del agente de WhatsApp que atiende una persona. El agente
 * solo responde lo que sabe; lo demás llega aquí como "Necesita atención".
 *
 * Por ahora son las del área de pruebas (/agente-whatsapp); cuando se conecte un
 * número de WhatsApp, las reales llegan a esta misma bandeja.
 */
export default async function Page({ searchParams }: PageProps<"/conversaciones">) {
  const perfil = await exigirConversaciones();
  const { c, estado } = await searchParams;
  const [conversaciones, ajustes] = await Promise.all([cargarConversaciones(), cargarAjustesAgente()]);

  const abierta = typeof c === "string" ? (conversaciones.find((x) => x.id === c) ?? null) : null;
  // Abre en el filtro que se pidió, o en el de la conversación abierta, o en "Necesitan atención".
  const filtro = esEstadoConversacion(estado) ? estado : (abierta?.estado ?? "necesita_atencion");

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Conversaciones</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          El agente de WhatsApp solo responde lo que sabe. Lo que no (cortes, pedidos, pagos, reclamos…) queda aquí
          como «Necesita atención» para que lo atienda una persona.
          {ROLES[perfil.rol].usarAgenteWhatsapp && (
            <>
              {" "}
              Por ahora son las conversaciones del{" "}
              <Link href="/agente-whatsapp" className="text-primary underline-offset-4 hover:underline">
                área de pruebas
              </Link>
              .
            </>
          )}
        </p>
      </header>
      <Conversaciones
        conversaciones={conversaciones}
        anuncios={ajustes.anuncios}
        abiertaInicial={abierta?.id ?? null}
        filtroInicial={filtro}
      />
    </div>
  );
}
