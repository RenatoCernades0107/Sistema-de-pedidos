"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Ellipsis, LayoutList, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { RUTA_PEDIDOS, esTerminal, herramientasDe, type ConfigHerramienta } from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { MenuUsuario } from "@/components/menu-usuario";
import { ActivarNotificaciones } from "@/components/activar-notificaciones";
import { ThemeToggle } from "@/components/theme-toggle";
import { ICONOS_HERRAMIENTA } from "@/components/iconos-herramienta";
import { CommandMenu, useCommandMenu } from "@/components/command-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Un enlace de la barra lateral: vistas y herramientas se pintan igual. */
const claseEnlaceLateral = (activo: boolean) =>
  cn(
    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    activo
      ? "text-foreground font-medium"
      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
  );

/** Un elemento de la barra de abajo del celular. */
const CLASE_TAB =
  "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium transition-colors";

/**
 * Lo abierto que le toca al rol: el número junto a "Pedidos". Los cerrados viven
 * en la misma vista, al fondo, pero no son trabajo pendiente.
 */
function useActivos() {
  const { permisos, pedidos } = useStore();
  return pedidos.filter((p) => permisos.base(p) && !esTerminal(p.estado)).length;
}

/** El detalle de un pedido también es "Pedidos"; el alta tiene su propio botón. */
const enPedidos = (pathname: string) =>
  pathname === RUTA_PEDIDOS ||
  (pathname.startsWith(`${RUTA_PEDIDOS}/`) && pathname !== "/pedidos/nuevo");

/** Una herramienta sigue marcada en sus subrutas: `/cotizaciones/nueva` es Cotizaciones. */
const enRuta = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function AppShell({
  children,
  usuario,
}: {
  children: React.ReactNode;
  usuario: string;
}) {
  const { permisos } = useStore();
  const pathname = usePathname();
  const activos = useActivos();
  const cmd = useCommandMenu();
  const [masAbierto, setMasAbierto] = useState(false);

  const herramientas = herramientasDe(permisos);
  const pedidosActivo = enPedidos(pathname);
  // Sin esto, estando en Cotizaciones no habría nada marcado en la barra.
  const menuActivo = herramientas.some((h) => enRuta(pathname, h.href));

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

          <ActivarNotificaciones />
          <MenuUsuario cuenta={usuario} />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="bg-sidebar hidden w-56 shrink-0 border-r p-3 md:block">
          <nav aria-label="Menú principal" className="flex flex-col gap-0.5">
            <p className="eyebrow px-2.5 pt-2 pb-2">{permisos.nombre}</p>
            {/* Una sola entrada: Todos, Míos, Taller, Tienda, Logística e
                Historial son filtros dentro de la vista, no pantallas. */}
            <Link
              href={RUTA_PEDIDOS}
              aria-current={pathname === RUTA_PEDIDOS ? "page" : undefined}
              className={claseEnlaceLateral(pedidosActivo)}
            >
              {pedidosActivo && (
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
              <LayoutList
                className={cn("size-4 shrink-0", pedidosActivo ? "text-primary" : "opacity-70")}
              />
              Pedidos
              <span className="tnum text-muted-foreground ml-auto text-xs">{activos}</span>
            </Link>

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

            {herramientas.length > 0 && (
              <>
                <p className="eyebrow px-2.5 pt-5 pb-2">Herramientas</p>
                {herramientas.map((h) => {
                  const activo = enRuta(pathname, h.href);
                  const Icono = ICONOS_HERRAMIENTA[h.href];
                  return (
                    <Link
                      key={h.href}
                      href={h.href}
                      aria-current={activo ? "page" : undefined}
                      className={claseEnlaceLateral(activo)}
                    >
                      <Icono
                        className={cn("size-4 shrink-0", activo ? "text-primary" : "opacity-70")}
                      />
                      {h.titulo}
                    </Link>
                  );
                })}
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
        aria-label="Navegación"
        className="bg-background/90 fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <Link
          href={RUTA_PEDIDOS}
          aria-current={pathname === RUTA_PEDIDOS ? "page" : undefined}
          className={cn(CLASE_TAB, pedidosActivo ? "text-primary" : "text-muted-foreground")}
        >
          <LayoutList className="size-5 shrink-0" />
          <span className="w-full truncate text-center">Pedidos</span>
        </Link>
        {permisos.crearPedido && (
          <Link
            href="/pedidos/nuevo"
            className={cn(
              CLASE_TAB,
              pathname === "/pedidos/nuevo" ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Plus className="size-5 shrink-0" />
            <span className="w-full truncate text-center">Nuevo</span>
          </Link>
        )}

        {/* Las herramientas. Operaciones, sin ninguna, no llega a ver este botón. */}
        {herramientas.length > 0 && (
          <Sheet open={masAbierto} onOpenChange={setMasAbierto}>
            <SheetTrigger
              className={cn(CLASE_TAB, menuActivo ? "text-primary" : "text-muted-foreground")}
            >
              <Ellipsis className="size-5 shrink-0" />
              <span className="w-full truncate text-center">Más</span>
            </SheetTrigger>

            <SheetContent
              side="bottom"
              className="max-h-[80dvh] gap-0 overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]"
            >
              <SheetHeader className="pb-2">
                <SheetTitle>Menú</SheetTitle>
              </SheetHeader>

              <div className="flex flex-col gap-0.5 px-2 pb-4">
                <p className="eyebrow px-2.5 pt-2 pb-2">Herramientas</p>
                {herramientas.map((h: ConfigHerramienta) => {
                  const activo = enRuta(pathname, h.href);
                  const Icono = ICONOS_HERRAMIENTA[h.href];
                  return (
                    <Link
                      key={h.href}
                      href={h.href}
                      aria-current={activo ? "page" : undefined}
                      onClick={() => setMasAbierto(false)}
                      className={claseEnlaceLateral(activo)}
                    >
                      <Icono
                        className={cn("size-4 shrink-0", activo ? "text-primary" : "opacity-70")}
                      />
                      {h.titulo}
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </nav>
    </div>
  );
}
