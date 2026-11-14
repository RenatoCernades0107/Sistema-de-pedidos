import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pedido no encontrado · Plexiacril",
  robots: { index: false, follow: false },
};

/** Para el cliente, no para el equipo: sin "entra" ni buscador. */
export default function SeguimientoNoEncontrado() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <p className="eyebrow">Seguimiento</p>
        <h1 className="mt-1.5 text-lg font-semibold">No encontramos este pedido</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Puede que el enlace esté incompleto o ya no sea válido. Escríbenos y te
          enviamos uno nuevo.
        </p>
      </div>
    </main>
  );
}
