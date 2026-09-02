"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  Archive,
  Hammer,
  LayoutList,
  MessageSquareText,
  Plus,
  Search,
  Store,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { VISTAS, type Vista } from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { MenuUsuario } from "@/components/menu-usuario";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandMenu, useCommandMenu } from "@/components/command-menu";

const ICONOS: Record<Vista, LucideIcon> = {
  admin: LayoutList,
  taller: Hammer,
  tienda: Store,
  logistica: Truck,
  historial: Archive,
};

const NOMBRE_CORTO: Record<Vista, string> = {
  admin: "Todos",
  taller: "Taller",
  tienda: "Tienda",
  logistica: "Logística",
  historial: "Historial",
};

function useNav() {
  const { permisos, pedidos } = useStore();
  return permisos.vistas.map((v) => ({
    vista: v,
    href: `/${v}`,
    icono: ICONOS[v],
    titulo: VISTAS[v].titulo,
    corto: NOMBRE_CORTO[v],
    total: pedidos.filter(VISTAS[v].filtro).length,
  }));
}

export function AppShell({
  children,
  usuario,
}: {
  children: React.ReactNode;
  usuario: string;
}) {
  const { permisos } = useStore();
  const pathname = usePathname();
  const nav = useNav();
  const cmd = useCommandMenu();

  return (
    <div className="flex min-h-dvh flex-col">
      <CommandMenu abierto={cmd.abierto} setAbierto={cmd.setAbierto} />

      {/* Con teclado, la cabecera y el menú se recorren en cada página antes de
          llegar a los pedidos. Este enlace se salta el cromo; solo aparece al
          enfocarlo. */}
      <a
        href="#contenido"
        className="bg-background focus:ring-ring sr-only rounded-lg border px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Saltar al contenido
      </a>

      {/* Cromo: casi invisible. El color se reserva para los datos. */}
      <header className="bg-background/85 sticky top-0 z-30 border-b backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-4">
          {/* A la raíz, no a /admin: el taller no tiene esa vista. */}
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            {/* Marca: azul y amarillo del logotipo, sin intermediarios */}
            <span className="bg-primary text-brand grid size-7 place-items-center rounded-md text-xs font-bold">
              P
            </span>
            <span className="hidden text-sm leading-tight font-semibold tracking-tight sm:block">
              Plexiacril
            </span>
          </Link>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => cmd.setAbierto(true)}
            aria-label="Buscar pedido"
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(
              "text-muted-foreground hover:border-ring/40 hover:text-foreground group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              "w-9 justify-center sm:w-56 sm:justify-start md:w-64",
            )}
          >
            <Search className="size-4 shrink-0" />
            <span className="hidden sm:inline">Buscar pedido…</span>
            <kbd className="bg-muted text-2xs text-muted-foreground ml-auto hidden rounded border px-1.5 py-0.5 font-sans font-medium sm:inline">
              ⌘K
            </kbd>
          </button>

          <MenuUsuario cuenta={usuario} />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="bg-sidebar hidden w-56 shrink-0 border-r p-3 md:block">
          <nav aria-label="Vistas" className="flex flex-col gap-0.5">
            <p className="eyebrow px-2.5 pt-2 pb-2">
              Vistas · {permisos.nombre}
            </p>
            {nav.map((item) => {
              const activo = pathname === item.href;
              const Icono = item.icono;
              return (
                <Link
                  key={item.vista}
                  href={item.href}
                  aria-current={activo ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                    activo
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                  )}
                >
                  {activo && (
                    <motion.span
                      layoutId="nav-activo"
                      className="bg-sidebar-accent absolute inset-0 -z-10 rounded-md"
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 32,
                      }}
                    />
                  )}
                  <Icono
                    className={cn(
                      "size-4 shrink-0",
                      activo ? "text-primary" : "opacity-70",
                    )}
                  />
                  {item.titulo}
                  <span className="tnum text-muted-foreground ml-auto text-xs">
                    {item.total}
                  </span>
                </Link>
              );
            })}

            {permisos.crearPedido && (
              <>
                <p className="eyebrow px-2.5 pt-5 pb-2">Acciones</p>
                <Button
                  render={<Link href="/pedidos/nuevo" />}
                  nativeButton={false}
                  className="w-full justify-start gap-2"
                >
                  <Plus className="size-4" />
                  Nuevo pedido
                </Button>
              </>
            )}

            {permisos.usarAgenteCotizacion && (
              <>
                <p className="eyebrow px-2.5 pt-5 pb-2">Herramientas</p>
                <Link
                  href="/cotizaciones"
                  aria-current={pathname === "/cotizaciones" ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                    pathname === "/cotizaciones"
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                  )}
                >
                  <MessageSquareText
                    className={cn(
                      "size-4 shrink-0",
                      pathname === "/cotizaciones" ? "text-primary" : "opacity-70",
                    )}
                  />
                  Cotizaciones
                </Link>
              </>
            )}
          </nav>
        </aside>

        {/* `tabIndex={-1}` para que el enlace de salto pueda dejar el foco aquí. */}
        <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 pb-20 md:pb-0">
          {children}
        </main>
      </div>

      {/* Tabs móviles */}
      <nav
        aria-label="Vistas"
        className="bg-background/90 fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {nav.map((item) => {
          const activo = pathname === item.href;
          const Icono = item.icono;
          return (
            <Link
              key={item.vista}
              href={item.href}
              aria-current={activo ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium transition-colors",
                activo ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icono className="size-5 shrink-0" />
              <span className="w-full truncate text-center">{item.corto}</span>
            </Link>
          );
        })}
        {permisos.crearPedido && (
          <Link
            href="/pedidos/nuevo"
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium transition-colors",
              pathname === "/pedidos/nuevo"
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            <Plus className="size-5 shrink-0" />
            <span className="w-full truncate text-center">Nuevo</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
