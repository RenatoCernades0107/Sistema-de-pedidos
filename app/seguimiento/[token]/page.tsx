import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { seguimientoPorToken } from "@/lib/compartir-servidor";
import { ESTADOS } from "@/lib/dominio";
import { VistaSeguimiento } from "@/components/seguimiento/vista-seguimiento";

/**
 * El seguimiento de un pedido para el cliente, sin cuenta: lo abre desde el
 * enlace que le mandaron por WhatsApp o Gmail. Vive fuera de `(app)`, así que
 * no carga la sesión, el store ni la navegación del equipo.
 *
 * Siempre se lee de nuevo (usa cookies vía Supabase, así que es dinámica): la
 * vista vuelve a pedirla cada tanto con `router.refresh()`.
 */
export async function generateMetadata({ params }: PageProps<"/seguimiento/[token]">): Promise<Metadata> {
  const s = await seguimientoPorToken((await params).token).catch(() => null);
  return {
    title: s ? `Pedido ${s.codigo} · ${ESTADOS[s.estado]} · Plexiacril` : "Seguimiento · Plexiacril",
    // Un enlace privado: que ningún buscador lo guarde.
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: PageProps<"/seguimiento/[token]">) {
  const { token } = await params;
  const seguimiento = await seguimientoPorToken(token);
  if (!seguimiento) notFound();
  return <VistaSeguimiento seguimiento={seguimiento} leidoEn={new Date().toISOString()} />;
}
