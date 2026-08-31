import { Suspense } from "react";
import type { Metadata } from "next";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = {
  title: "Entrar · Plexiacril",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-brand grid size-10 place-items-center rounded-lg text-sm font-bold">
            P
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Pedidos · Plexiacril</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Entra con tu usuario. Lo que ves depende de tu rol.
            </p>
          </div>
        </div>

        {/* useSearchParams obliga a un límite de Suspense en el prerender. */}
        <Suspense fallback={null}>
          <FormularioLogin />
        </Suspense>
      </div>
    </main>
  );
}
