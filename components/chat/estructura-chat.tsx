"use client";

/**
 * `/chat`: la lista de conversaciones a la izquierda y la abierta a la derecha.
 * En el celular, una columna a la vez: la lista, o la conversación con su botón
 * de atrás. Vive en el layout para que la lista no se vuelva a leer al pasar de
 * una conversación a otra.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtSign, Hash, MessageCirclePlus, Package, Plus, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { hoy, momentoEnLima } from "@/lib/fecha";
import { agruparConversaciones, horaCorta, vistaPrevia } from "@/lib/chat/logica";
import type { ResumenConversacion } from "@/lib/chat/tipos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "./personas";
import { NuevoCanal, NuevoDirecto } from "./dialogos";
import { useResumen } from "./use-resumen";

/** Lo que queda de alto bajo la cabecera de la app (y sobre las pestañas del celular). */
export const ALTO_CHAT = "h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem)]";

export function EstructuraChat({
  usuarioId,
  esAdmin,
  children,
}: {
  usuarioId: string;
  esAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const abierta = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length).split("/")[0] : null;

  return (
    <div className={cn("flex overflow-hidden", ALTO_CHAT)}>
      <aside
        className={cn(
          "bg-sidebar/40 min-h-0 w-full flex-col border-r md:flex md:w-80 lg:w-96",
          abierta ? "hidden" : "flex",
        )}
        aria-label="Conversaciones"
      >
        <ListaConversaciones usuarioId={usuarioId} esAdmin={esAdmin} abierta={abierta} />
      </aside>
      <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", abierta ? "flex" : "hidden")}>
        {children}
      </section>
    </div>
  );
}

function ListaConversaciones({
  usuarioId,
  esAdmin,
  abierta,
}: {
  usuarioId: string;
  esAdmin: boolean;
  abierta: string | null;
}) {
  const { conversaciones, cargando, error } = useResumen();
  const [filtro, setFiltro] = useState("");
  const [nuevoDirecto, setNuevoDirecto] = useState(false);
  const [nuevoCanal, setNuevoCanal] = useState(false);
  const grupos = agruparConversaciones(conversaciones, filtro);
  const hoyLima = hoy();

  return (
    <>
      <header className="flex items-center gap-1 px-3 pt-3 pb-2">
        <h1 className="flex-1 text-lg font-semibold tracking-tight">Chat</h1>
        {esAdmin && (
          <Button variant="ghost" size="sm" onClick={() => setNuevoCanal(true)} className="gap-1">
            <Plus /> Canal
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setNuevoDirecto(true)} className="gap-1">
          <MessageCirclePlus /> Directo
        </Button>
      </header>
      <div className="relative px-3 pb-2">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 -mt-1" />
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar conversación…"
          aria-label="Buscar conversación"
          className="pl-8"
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {cargando && (
          <div className="flex flex-col gap-2 p-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}
        {error && !cargando && (
          <p className="text-destructive p-3 text-sm">No se pudo leer la lista. Revisa tu conexión.</p>
        )}
        {!cargando && grupos.length === 0 && !error && (
          <p className="text-muted-foreground p-3 text-sm">
            {filtro ? "Ninguna conversación con ese nombre." : "Todavía no hay conversaciones."}
          </p>
        )}
        {grupos.map((g) => (
          <section key={g.tipo} className="mt-2 first:mt-0">
            {g.tipo !== "general" && <h2 className="eyebrow px-2.5 pt-3 pb-1.5">{g.titulo}</h2>}
            <ul className="flex flex-col gap-0.5">
              {g.conversaciones.map((c) => (
                <li key={c.id}>
                  <FilaConversacion c={c} usuarioId={usuarioId} activa={c.id === abierta} hoyLima={hoyLima} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <NuevoDirecto abierto={nuevoDirecto} onCambio={setNuevoDirecto} usuarioId={usuarioId} />
      {esAdmin && <NuevoCanal abierto={nuevoCanal} onCambio={setNuevoCanal} usuarioId={usuarioId} />}
    </>
  );
}

export function IconoConversacion({ c, className }: { c: Pick<ResumenConversacion, "tipo" | "nombre">; className?: string }) {
  if (c.tipo === "directo") return <Avatar nombre={c.nombre} className={className} />;
  const Icono = c.tipo === "general" ? Users : c.tipo === "canal" ? Hash : Package;
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-full",
        c.tipo === "general" && "bg-primary text-primary-foreground",
        className,
      )}
    >
      <Icono className="size-4" />
    </span>
  );
}

function FilaConversacion({
  c,
  usuarioId,
  activa,
  hoyLima,
}: {
  c: ResumenConversacion;
  usuarioId: string;
  activa: boolean;
  hoyLima: string;
}) {
  const conNovedad = c.sinLeer > 0;
  return (
    <Link
      href={`/chat/${c.id}`}
      aria-current={activa ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors outline-none",
        "focus-visible:ring-ring focus-visible:ring-2",
        activa ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <IconoConversacion c={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", conNovedad ? "font-semibold" : "font-medium")}>
            {c.nombre}
          </span>
          <span className={cn("tnum shrink-0 text-2xs", conNovedad ? "text-primary font-medium" : "text-muted-foreground")}>
            {horaCorta(momentoEnLima(c.ultimoMensajeEn), hoyLima)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-xs", conNovedad ? "text-foreground" : "text-muted-foreground")}>
            {vistaPrevia(c, usuarioId)}
          </span>
          {c.mencionesSinLeer > 0 && (
            <span
              className="bg-primary text-primary-foreground grid size-5 shrink-0 place-items-center rounded-full"
              aria-label="Te mencionaron"
            >
              <AtSign className="size-3" />
            </span>
          )}
          {conNovedad && (
            <span
              className="bg-primary text-primary-foreground tnum grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-2xs font-semibold"
              aria-label={`${c.sinLeer} sin leer`}
            >
              {c.sinLeer > 99 ? "99+" : c.sinLeer}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
