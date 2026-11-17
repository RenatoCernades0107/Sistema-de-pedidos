"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  Ellipsis,
  LayoutList,
  MessageCircle,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  RUTA_PEDIDOS,
  esTerminal,
  gruposDe,
  type ConfigHerramienta,
} from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { MenuUsuario } from "@/components/menu-usuario";
import { ActivarNotificaciones } from "@/components/activar-notificaciones";
import { ThemeToggle } from "@/components/theme-toggle";
import { ICONOS_HERRAMIENTA } from "@/components/iconos-herramienta";
import { CommandMenu, useCommandMenu } from "@/components/command-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useNoLeidos } from "@/components/chat/use-no-leidos";

/** El globo de "Chat": cuántos mensajes sin leer, con @ si alguno te menciona. */
function GloboChat({ total, menciones }: { total: number; menciones: number }) {
  if (total === 0) return null;
  return (
    <span
      className="bg-primary text-primary-foreground tnum ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-2xs font-semibold"
      aria-label={`${total} sin leer${menciones ? `, te mencionaron` : ""}`}
    >
      {menciones > 0 && "@"}
      {total > 99 ? "99+" : total}
    </span>
  );
}

/** Un enlace de la barra lateral: Pedidos y las demás vistas se pintan igual. */
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
  return pedidos.filter((p) => permisos.base(p) && !esTerminal(p.estado))
    .length;
}

/** El detalle de un pedido también es "Pedidos"; el alta tiene su propio botón. */
const enPedidos = (pathname: string) =>
  pathname === RUTA_PEDIDOS ||
  (pathname.startsWith(`${RUTA_PEDIDOS}/`) && pathname !== "/pedidos/nuevo");

/** Una herramienta sigue marcada en sus subrutas: `/cotizaciones/nueva` es Cotizaciones. */
const enRuta = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Una vista del menú: la misma en la barra lateral y en la hoja "Más". */
function EnlaceVista({
  vista,
  pathname,
  noLeidos,
  onClick,
}: {
  vista: ConfigHerramienta;
  pathname: string;
  noLeidos: { total: number; menciones: number };
  onClick?: () => void;
}) {
  const activo = enRuta(pathname, vista.href);
  const Icono = ICONOS_HERRAMIENTA[vista.href];
  return (
    <Link
      href={vista.href}
      aria-current={activo ? "page" : undefined}
      onClick={onClick}
      className={claseEnlaceLateral(activo)}
    >
      <Icono
        className={cn(
          "size-4 shrink-0",
          activo ? "text-primary" : "opacity-70",
        )}
      />
      {vista.titulo}
      {vista.href === "/chat" && <GloboChat {...noLeidos} />}
    </Link>
  );
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
  const activos = useActivos();
  const cmd = useCommandMenu();
  const [masAbierto, setMasAbierto] = useState(false);
  const noLeidos = useNoLeidos();

  const grupos = gruposDe(permisos);
  // En el celular el Chat tiene pestaña propia; "Más" se queda con el resto.
  const chatEnBarra = permisos.usarChat;
  const gruposMas = gruposDe(permisos, chatEnBarra ? ["/chat"] : []);
  const pedidosActivo = enPedidos(pathname);
  const chatActivo = enRuta(pathname, "/chat");
  // Sin esto, estando en Cotizaciones no habría nada marcado en la barra.
  const menuActivo = gruposMas.some((g) =>
    g.vistas.some((h) => enRuta(pathname, h.href)),
  );

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
      <header className="bg-background/85 sticky top-0 z-30 border-b backdrop-blur-md print:hidden">
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
        <aside className="bg-sidebar hidden w-56 shrink-0 border-r p-3 md:block print:hidden">
          <nav aria-label="Menú principal" className="flex flex-col gap-0.5">
            {permisos.crearPedido && (
              <Button
                render={<Link href="/pedidos/nuevo" />}
                nativeButton={false}
                className="mt-1 mb-3 w-full justify-start gap-2"
              >
                <Plus className="size-4" />
                Nuevo pedido
              </Button>
            )}

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
                className={cn(
                  "size-4 shrink-0",
                  pedidosActivo ? "text-primary" : "opacity-70",
                )}
              />
              Pedidos
              <span className="tnum text-muted-foreground ml-auto text-xs">
                {activos}
              </span>
            </Link>

            {/* El grupo principal sigue a Pedidos sin título; los demás lo llevan. */}
            {grupos.map((g) => (
              <div key={g.id} className="flex flex-col gap-0.5">
                {g.titulo && (
                  <p className="eyebrow px-2.5 pt-5 pb-2">{g.titulo}</p>
                )}
                {g.vistas.map((h) => (
                  <EnlaceVista
                    key={h.href}
                    vista={h}
                    pathname={pathname}
                    noLeidos={noLeidos}
                  />
                ))}
              </div>
            ))}
          </nav>
        </aside>

        {/* `tabIndex={-1}` para que el enlace de salto pueda dejar el foco aquí. */}
        <main
          id="contenido"
          tabIndex={-1}
          className="min-w-0 flex-1 pb-20 md:pb-0 print:pb-0"
        >
          {children}
        </main>
      </div>

      {/* Tabs móviles */}
      <nav
        aria-label="Navegación"
        className="bg-background/90 fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
      >
        <Link
          href={RUTA_PEDIDOS}
          aria-current={pathname === RUTA_PEDIDOS ? "page" : undefined}
          className={cn(
            CLASE_TAB,
            pedidosActivo ? "text-primary" : "text-muted-foreground",
          )}
        >
          <LayoutList className="size-5 shrink-0" />
          <span className="w-full truncate text-center">Pedidos</span>
        </Link>
        {permisos.crearPedido && (
          <Link
            href="/pedidos/nuevo"
            className={cn(
              CLASE_TAB,
              pathname === "/pedidos/nuevo"
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            <Plus className="size-5 shrink-0" />
            <span className="w-full truncate text-center">Nuevo</span>
          </Link>
        )}

        {chatEnBarra && (
          <Link
            href="/chat"
            aria-current={chatActivo ? "page" : undefined}
            className={cn(
              CLASE_TAB,
              chatActivo ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              <MessageCircle className="size-5 shrink-0" />
              {noLeidos.total > 0 && (
                <span
                  className="bg-primary text-primary-foreground ring-background tnum absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-2xs leading-none font-semibold ring-2"
                  aria-label={`${noLeidos.total} sin leer${noLeidos.menciones ? ", te mencionaron" : ""}`}
                >
                  {noLeidos.menciones > 0 && "@"}
                  {noLeidos.total > 99 ? "99+" : noLeidos.total}
                </span>
              )}
            </span>
            <span className="w-full truncate text-center">Chat</span>
          </Link>
        )}

        {/* Lo que no cabe en la barra, con los mismos grupos que la lateral. */}
        {gruposMas.length > 0 && (
          <Sheet open={masAbierto} onOpenChange={setMasAbierto}>
            <SheetTrigger
              className={cn(
                CLASE_TAB,
                menuActivo ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <Ellipsis className="size-5 shrink-0" />
                {/* Solo si el Chat no tiene pestaña propia y vive aquí dentro. */}
                {!chatEnBarra && noLeidos.total > 0 && (
                  <span className="bg-primary ring-background absolute -top-0.5 -right-1 size-2 rounded-full ring-2" />
                )}
              </span>
              <span className="w-full truncate text-center">Más</span>
            </SheetTrigger>

            <SheetContent
              side="bottom"
              className="max-h-[80dvh] gap-0 overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]"
            >
              <SheetHeader className="pb-2">
                <SheetTitle>Más</SheetTitle>
              </SheetHeader>

              <div className="flex flex-col gap-0.5 px-2 pb-4">
                {gruposMas.map((g) => (
                  <div key={g.id} className="flex flex-col gap-0.5">
                    {g.titulo && (
                      <p className="eyebrow px-2.5 pt-4 pb-2">{g.titulo}</p>
                    )}
                    {g.vistas.map((h) => (
                      <EnlaceVista
                        key={h.href}
                        vista={h}
                        pathname={pathname}
                        noLeidos={noLeidos}
                        onClick={() => setMasAbierto(false)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </nav>
    </div>
  );
}
