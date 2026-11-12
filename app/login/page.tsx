import { Suspense } from "react";
import Image from "next/image";
import type { Metadata } from "next";
import { ClipboardList, Factory, Truck } from "lucide-react";
import { FondoAcrilico } from "@/components/fondo-acrilico";
import { FormularioLogin } from "./formulario-login";
import logo from "@/public/logo-plexiacril.webp";

export const metadata: Metadata = {
  title: "Iniciar sesión · Plexiacril",
};

const PUNTOS = [
  { icono: ClipboardList, texto: "Registra y sigue cada pedido de principio a fin" },
  { icono: Factory, texto: "Coordina el trabajo del taller en tiempo real" },
  { icono: Truck, texto: "Controla despachos, entregas y saldos pendientes" },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* ── Panel de marca (solo en pantallas anchas) ── */}
      <aside className="relative hidden overflow-hidden bg-[#003a6e] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <FondoAcrilico />

        <span className="relative text-xs font-medium tracking-[0.2em] text-white/70 uppercase">
          Sistema de pedidos
        </span>

        <div className="relative max-w-md">
          <h2 className="text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-balance">
            Cada pedido, <span className="text-[#ffc200]">bajo control</span>.
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-white/75">
            La plataforma interna de Plexiacril para administración, logística y
            taller.
          </p>

          <ul className="mt-10 flex flex-col gap-4">
            {PUNTOS.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icono className="size-4 text-[#ffc200]" />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/55">
          © {new Date().getFullYear()} Plexiacril · Acrílicos de calidad
        </p>
      </aside>

      {/* ── Formulario ── */}
      <section className="bg-background relative flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[22rem]">
          <div className="mb-10 flex justify-center lg:justify-start">
            {/* En oscuro el logotipo (azul sobre transparente) se perdería: va sobre blanco. */}
            <div className="dark:rounded-xl dark:bg-white dark:px-4 dark:py-3">
              <Image
                src={logo}
                alt="Plexiacril — Acrílicos de calidad"
                priority
                className="h-auto w-[210px]"
              />
            </div>
          </div>

          <div className="mb-8 text-center lg:text-left">
            <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Ingresa con el usuario y la contraseña que te asignó el administrador.
            </p>
          </div>

          {/* useSearchParams obliga a un límite de Suspense en el prerender. */}
          <Suspense fallback={null}>
            <FormularioLogin />
          </Suspense>

          <p className="text-muted-foreground mt-10 text-center text-xs lg:text-left">
            ¿Problemas para entrar? Contacta al administrador del sistema.
          </p>
        </div>

        <p className="text-muted-foreground absolute bottom-6 text-xs lg:hidden">
          © {new Date().getFullYear()} Plexiacril
        </p>
      </section>
    </main>
  );
}
