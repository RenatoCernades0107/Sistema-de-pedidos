import Image from "next/image";
import type { Metadata } from "next";
import { FormularioRecuperacion } from "./formulario";
import logo from "@/public/logo-plexiacril.webp";

export const metadata: Metadata = {
  title: "Recuperar contraseña · Plexiacril",
};

export default async function OlvideContrasenaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-[22rem]">
        <div className="mb-8 flex justify-center">
          <div className="dark:rounded-xl dark:bg-white dark:px-4 dark:py-3">
            <Image src={logo} alt="Plexiacril — Acrílicos de calidad" priority className="h-auto w-[180px]" />
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Escribe tu usuario y te enviamos un enlace al correo de recuperación de tu cuenta.
          </p>
        </div>

        <FormularioRecuperacion enlaceInvalido={error === "enlace"} />
      </div>
    </main>
  );
}
