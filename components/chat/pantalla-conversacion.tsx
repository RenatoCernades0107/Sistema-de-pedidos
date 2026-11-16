"use client";

/**
 * La conversación abierta en `/chat/<id>`: la cabecera (nombre, de qué se trata,
 * cuántos están) con lo que se puede hacer con un canal, y debajo los mensajes.
 *
 * Los canales los administra Administración (nombre, descripción, quién está,
 * eliminarlo); cualquiera puede ver quiénes están y salirse.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  EllipsisVertical,
  ExternalLink,
  Loader2,
  LogOut,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ROLES } from "@/lib/dominio";
import { clienteNavegador } from "@/lib/supabase-cliente";
import type { ChatInicial } from "@/lib/chat/consultas";
import type { TipoConversacion } from "@/lib/chat/tipos";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VistaConversacion } from "./chat-conversacion";
import { EditarCanal } from "./dialogos";
import { IconoConversacion } from "./estructura-chat";
import { Avatar, SelectorPersonas } from "./personas";
import { useConversacion, type Conversacion } from "./use-conversacion";
import { recargarResumen } from "./use-resumen";

export interface InfoConversacion {
  id: string;
  tipo: TipoConversacion;
  nombre: string;
  descripcion: string | null;
  /** Solo en las de pedido. */
  pedidoCodigo: string | null;
}

export function PantallaConversacion({
  info,
  usuarioId,
  esAdmin,
  inicial,
}: {
  info: InfoConversacion;
  usuarioId: string;
  esAdmin: boolean;
  inicial: ChatInicial | null;
}) {
  const chat = useConversacion({ conversacionId: info.id, usuarioId, inicial });
  const otro = info.tipo === "directo" ? chat.participantes.find((p) => p.usuarioId !== usuarioId) : undefined;
  const nombre = info.tipo === "directo" ? (otro?.nombre ?? info.nombre) : info.nombre;

  const subtitulo =
    info.tipo === "directo"
      ? otro
        ? ROLES[otro.rol].nombre
        : "Mensaje directo"
      : info.tipo === "pedido"
        ? "Lo ven Administración, Logística y el taller"
        : [info.descripcion, personas(chat.participantes.length)].filter(Boolean).join(" · ");

  return (
    <>
      <header className="flex items-center gap-2 border-b px-2 py-2 sm:px-3">
        <Button
          render={<Link href="/chat" />}
          nativeButton={false}
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Volver a las conversaciones"
        >
          <ArrowLeft />
        </Button>
        <IconoConversacion c={{ tipo: info.tipo, nombre }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{nombre}</h2>
          <p className="text-muted-foreground truncate text-xs">{subtitulo}</p>
        </div>
        {info.tipo === "pedido" && info.pedidoCodigo && (
          <Button
            render={<Link href={`/pedidos/${encodeURIComponent(info.pedidoCodigo)}`} />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            <ExternalLink /> Ver pedido
          </Button>
        )}
        {(info.tipo === "canal" || info.tipo === "general") && (
          <AccionesCanal info={info} chat={chat} usuarioId={usuarioId} esAdmin={esAdmin} />
        )}
      </header>
      <VistaConversacion
        chat={chat}
        mostrarAutor={info.tipo !== "directo"}
        autoFoco
        placeholder={`Escribe a ${info.tipo === "canal" ? `#${nombre}` : nombre}… (@ para referenciar)`}
        vacio={
          info.tipo === "directo"
            ? `Escríbele a ${nombre}. Solo lo ven ustedes dos.`
            : "Todavía no hay mensajes. Escribe el primero."
        }
      />
    </>
  );
}

const personas = (n: number) => (n === 0 ? "" : n === 1 ? "1 persona" : `${n} personas`);

function AccionesCanal({
  info,
  chat,
  usuarioId,
  esAdmin,
}: {
  info: InfoConversacion;
  chat: Conversacion;
  usuarioId: string;
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [miembros, setMiembros] = useState(false);
  const [editando, setEditando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const esCanal = info.tipo === "canal";
  const soyMiembro = chat.participantes.some((p) => p.usuarioId === usuarioId);

  const salir = async () => {
    setOcupado(true);
    const { error } = await clienteNavegador().rpc("quitar_miembro", {
      p_conversacion_id: info.id,
      p_usuario_id: usuarioId,
    });
    setOcupado(false);
    if (error) {
      toast.error("No se pudo salir del canal", { description: error.message });
      return;
    }
    setSaliendo(false);
    toast.success(`Saliste de #${info.nombre}`);
    void recargarResumen();
    // Administración sigue viendo el canal (lo administra); los demás ya no.
    if (esAdmin) void chat.recargarParticipantes();
    else router.push("/chat");
  };

  const eliminar = async () => {
    setOcupado(true);
    const { error } = await clienteNavegador().rpc("eliminar_canal", { p_conversacion_id: info.id });
    setOcupado(false);
    if (error) {
      toast.error("No se pudo eliminar el canal", { description: error.message });
      return;
    }
    setEliminando(false);
    toast.success(`Se eliminó #${info.nombre}`);
    void recargarResumen();
    router.push("/chat");
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setMiembros(true)} aria-label="Ver miembros">
        <Users />
        <span className="tnum">{chat.participantes.length || ""}</span>
      </Button>
      {esCanal && (esAdmin || soyMiembro) && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Opciones del canal" />}>
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setMiembros(true)}>
              <Users /> Miembros
            </DropdownMenuItem>
            {esAdmin && (
              <DropdownMenuItem onClick={() => setEditando(true)}>
                <Pencil /> Editar canal
              </DropdownMenuItem>
            )}
            {soyMiembro && (
              <DropdownMenuItem onClick={() => setSaliendo(true)}>
                <LogOut /> Salir del canal
              </DropdownMenuItem>
            )}
            {esAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setEliminando(true)}>
                  <Trash2 /> Eliminar canal
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Miembros
        abierto={miembros}
        onCambio={setMiembros}
        info={info}
        chat={chat}
        usuarioId={usuarioId}
        gestionar={esCanal && esAdmin}
      />

      {editando && (
        <EditarCanal
          abierto
          onCambio={setEditando}
          conversacionId={info.id}
          nombreActual={info.nombre}
          descripcionActual={info.descripcion}
        />
      )}

      <AlertDialog open={saliendo} onOpenChange={setSaliendo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir de #{info.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejarás de recibir sus mensajes. Para volver, Administración tiene que agregarte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void salir()} disabled={ocupado}>
              {ocupado && <Loader2 className="animate-spin" />}
              Salir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={eliminando} onOpenChange={setEliminando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar #{info.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran el canal y todos sus mensajes y archivos para todos. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void eliminar()} disabled={ocupado}>
              {ocupado && <Loader2 className="animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Miembros({
  abierto,
  onCambio,
  info,
  chat,
  usuarioId,
  gestionar,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  info: InfoConversacion;
  chat: Conversacion;
  usuarioId: string;
  gestionar: boolean;
}) {
  const [agregando, setAgregando] = useState(false);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const quitar = async (id: string, nombre: string) => {
    setOcupado(id);
    const { error } = await clienteNavegador().rpc("quitar_miembro", { p_conversacion_id: info.id, p_usuario_id: id });
    setOcupado(null);
    if (error) {
      toast.error(`No se pudo sacar a ${nombre}`, { description: error.message });
      return;
    }
    await chat.recargarParticipantes();
    void recargarResumen();
  };

  const agregar = async () => {
    if (elegidos.length === 0) return;
    setOcupado("agregar");
    const { error } = await clienteNavegador().rpc("agregar_miembros", {
      p_conversacion_id: info.id,
      p_usuarios: elegidos,
    });
    setOcupado(null);
    if (error) {
      toast.error("No se pudo agregar", { description: error.message });
      return;
    }
    setElegidos([]);
    setAgregando(false);
    await chat.recargarParticipantes();
    void recargarResumen();
  };

  return (
    <Sheet
      open={abierto}
      onOpenChange={(v) => {
        onCambio(v);
        if (!v) {
          setAgregando(false);
          setElegidos([]);
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b">
          <SheetTitle>{info.tipo === "general" ? "General" : `#${info.nombre}`}</SheetTitle>
          <SheetDescription>
            {info.tipo === "general" ? "Todo el equipo está en General." : personas(chat.participantes.length)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {gestionar && !agregando && (
            <Button variant="outline" onClick={() => setAgregando(true)} className="self-start">
              <UserPlus /> Agregar personas
            </Button>
          )}
          {gestionar && agregando && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <SelectorPersonas
                multiple
                excluir={chat.participantes.map((p) => p.usuarioId)}
                elegidos={elegidos}
                onElegir={(p) => setElegidos((e) => (e.includes(p.id) ? e.filter((x) => x !== p.id) : [...e, p.id]))}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAgregando(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => void agregar()} disabled={elegidos.length === 0 || ocupado !== null}>
                  {ocupado === "agregar" && <Loader2 className="animate-spin" />}
                  Agregar {elegidos.length || ""}
                </Button>
              </div>
            </div>
          )}

          <ul className="flex flex-col gap-1">
            {chat.participantes.map((p) => (
              <li key={p.usuarioId} className="flex items-center gap-3 py-1">
                <Avatar nombre={p.nombre} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.nombre}
                    {p.usuarioId === usuarioId && <span className="text-muted-foreground font-normal"> (tú)</span>}
                  </span>
                  <span className="text-muted-foreground block text-xs">{ROLES[p.rol].nombre}</span>
                </span>
                {gestionar && p.usuarioId !== usuarioId && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void quitar(p.usuarioId, p.nombre)}
                    disabled={ocupado !== null}
                    aria-label={`Sacar a ${p.nombre} del canal`}
                  >
                    {ocupado === p.usuarioId ? <Loader2 className="animate-spin" /> : <UserMinus />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
