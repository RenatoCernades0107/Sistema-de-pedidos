"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BotMessageSquare, CheckCheck, Headset, Megaphone, MessagesSquare, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  devolverAlAgente,
  leerConversacion,
  marcarResuelta,
  responderComoAsesor,
} from "@/app/(app)/conversaciones/acciones";
import type { AnuncioConfigurado } from "@/lib/agente-whatsapp/ajustes";
import { ESTADOS_CONVERSACION, type EstadoConversacion } from "@/lib/agente-whatsapp/estado";
import { vistaPreviaMensaje, type ConversacionResumen, type MensajePrueba, type PruebaResumen } from "@/lib/agente-whatsapp/pruebas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Burbuja, FONDO_CHAT, TarjetaAnuncio, Traza, esNotaDerivacion, motivoDeDerivacion } from "./burbujas";

const FILTROS: EstadoConversacion[] = ["necesita_atencion", "agente", "asesor", "resuelta"];

/** Cada cuánto se vuelve a mirar si hay conversaciones nuevas que atender. */
const REFRESCO_MS = 30_000;

const COLOR_ESTADO: Record<EstadoConversacion, string> = {
  necesita_atencion: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  agente: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  asesor: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  resuelta: "bg-muted text-muted-foreground",
};

/** "hace 5 min", "hace 2 h", "hace 3 d". */
function haceCuanto(iso: string, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function EtiquetaEstado({ estado }: { estado: EstadoConversacion }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", COLOR_ESTADO[estado])}>
      {ESTADOS_CONVERSACION[estado]}
    </span>
  );
}

/**
 * La bandeja de las conversaciones del agente. A la izquierda, la lista por
 * estado ("Necesitan atención" primero, la que más espera arriba); a la derecha,
 * la conversación, con lo que puede hacer quien atiende: responder como asesor,
 * devolverla al agente o cerrarla.
 */
export function Conversaciones({
  conversaciones,
  anuncios,
  abiertaInicial,
  filtroInicial,
}: {
  conversaciones: ConversacionResumen[];
  anuncios: AnuncioConfigurado[];
  abiertaInicial: string | null;
  filtroInicial: EstadoConversacion;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<EstadoConversacion>(filtroInicial);
  const [abierta, setAbierta] = useState<string | null>(abiertaInicial);
  const [detalle, setDetalle] = useState<{ conversacion: PruebaResumen; mensajes: MensajePrueba[] } | null>(null);
  const [cargando, setCargando] = useState(abiertaInicial !== null);
  const [respuesta, setRespuesta] = useState("");
  const [ocupado, iniciar] = useTransition();
  const [ahora, setAhora] = useState(() => Date.now());
  const fondo = useRef<HTMLDivElement>(null);
  const vigente = useRef<string | null>(abiertaInicial);

  const cuenta = (e: EstadoConversacion) => conversaciones.filter((c) => c.estado === e).length;
  const lista = conversaciones.filter((c) => c.estado === filtro);

  const cargar = (id: string) =>
    leerConversacion(id).then((r) => {
      if (vigente.current !== id) return;
      setCargando(false);
      if (r.ok) setDetalle({ conversacion: r.conversacion, mensajes: r.mensajes });
      else toast.error("No se abrió la conversación", { description: r.error });
    });

  const abrir = (id: string | null) => {
    vigente.current = id;
    setAbierta(id);
    setDetalle(null);
    setRespuesta("");
    setCargando(id !== null);
    if (id) cargar(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    url.searchParams.set("estado", filtro);
    window.history.replaceState(null, "", url);
  };

  useEffect(() => {
    if (abiertaInicial) cargar(abiertaInicial);
    // Cada tanto: la lista (por si llegó algo que atender) y la conversación abierta.
    const reloj = setInterval(() => {
      setAhora(Date.now());
      router.refresh();
      if (vigente.current) cargar(vigente.current);
    }, REFRESCO_MS);
    return () => clearInterval(reloj);
    // Solo al montar: después, cada cambio pasa por `abrir`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fondo.current?.scrollIntoView({ block: "end" });
  }, [detalle?.mensajes.length]);

  const conversacion = detalle?.conversacion ?? conversaciones.find((c) => c.id === abierta) ?? null;
  const ultimaNota = [...(detalle?.mensajes ?? [])].reverse().find(esNotaDerivacion) ?? null;

  const responder = () =>
    iniciar(async () => {
      if (!abierta || !respuesta.trim()) return;
      const r = await responderComoAsesor({ id: abierta, texto: respuesta });
      if (!r.ok) {
        toast.error("No se envió", { description: r.error });
        return;
      }
      setRespuesta("");
      setDetalle((d) =>
        d && { conversacion: { ...d.conversacion, estado: "asesor" }, mensajes: [...d.mensajes, r.mensaje] },
      );
    });

  const accion = (hacer: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) =>
    iniciar(async () => {
      if (!abierta) return;
      const r = await hacer(abierta);
      if (!r.ok) {
        toast.error("No se pudo", { description: r.error });
        return;
      }
      toast.success(exito);
      await cargar(abierta);
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* ── La lista ── */}
      <aside className={cn("flex flex-col gap-3", abierta && "hidden lg:flex")}>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar por estado">
          {FILTROS.map((e) => (
            <button
              key={e}
              type="button"
              role="tab"
              aria-selected={filtro === e}
              onClick={() => setFiltro(e)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                filtro === e ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
              )}
            >
              {ESTADOS_CONVERSACION[e]}
              <span
                className={cn(
                  "tnum rounded-full px-1.5 text-[11px]",
                  e === "necesita_atencion" && cuenta(e) > 0 ? "bg-amber-500 text-white" : "bg-muted",
                )}
              >
                {cuenta(e)}
              </span>
            </button>
          ))}
        </div>
        <ul className="bg-card flex flex-col divide-y overflow-hidden rounded-xl border lg:max-h-[min(74vh,700px)] lg:overflow-y-auto">
          {lista.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => c.id !== abierta && abrir(c.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-1 px-3.5 py-3 text-left transition-colors",
                  abierta === c.id ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="line-clamp-1 flex-1 text-sm font-medium">{c.titulo}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {haceCuanto(c.estado === "necesita_atencion" ? (c.atencionDesde ?? c.actualizadoEn) : c.actualizadoEn, ahora)}
                  </span>
                </span>
                <span className="text-muted-foreground line-clamp-1 text-xs">{vistaPreviaMensaje(c.ultimoMensaje)}</span>
                {(c.motivoAtencion || c.anuncio) && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {c.motivoAtencion && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                        <Headset className="size-3" aria-hidden />
                        {c.motivoAtencion}
                      </span>
                    )}
                    {c.anuncio && (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                        <Megaphone className="size-3" aria-hidden />
                        Anuncio
                      </span>
                    )}
                  </span>
                )}
              </button>
            </li>
          ))}
          {lista.length === 0 && (
            <li className="text-muted-foreground px-4 py-8 text-center text-sm">
              {filtro === "necesita_atencion"
                ? "Nada pendiente: el agente está atendiendo todo lo que sabe responder."
                : "No hay conversaciones aquí."}
            </li>
          )}
        </ul>
      </aside>

      {/* ── La conversación ── */}
      {conversacion ? (
        <section className="bg-card flex h-[min(80vh,760px)] min-h-[480px] flex-col overflow-hidden rounded-xl border">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-[#f0f2f5] px-3 py-2.5 sm:px-4 dark:bg-[#202c33]">
            <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Volver a la lista" onClick={() => abrir(null)}>
              <ArrowLeft />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{conversacion.titulo}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs">
                <EtiquetaEstado estado={conversacion.estado} />
                {conversacion.motivoAtencion && (
                  <span className="text-muted-foreground">Motivo: {conversacion.motivoAtencion}</span>
                )}
                <Badge variant="outline" className="h-5 text-[10px]">
                  Prueba
                </Badge>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {conversacion.estado !== "agente" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado}
                  onClick={() => accion(devolverAlAgente, "El agente vuelve a responder en esta conversación")}
                >
                  <BotMessageSquare data-icon="inline-start" />
                  Devolver al agente
                </Button>
              )}
              {conversacion.estado !== "resuelta" && (
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => accion(marcarResuelta, "Conversación resuelta")}>
                  <CheckCheck data-icon="inline-start" />
                  Marcar resuelta
                </Button>
              )}
            </div>
          </header>

          <div className={cn("flex-1 overflow-y-auto px-3 py-4 sm:px-6", FONDO_CHAT)}>
            <div className="mx-auto flex max-w-2xl flex-col gap-2">
              {conversacion.anuncio && <TarjetaAnuncio anuncio={conversacion.anuncio} anuncios={anuncios} />}
              {cargando && <p className="text-muted-foreground py-8 text-center text-sm">Abriendo…</p>}
              {detalle?.mensajes.map((m) => <Burbuja key={m.id} mensaje={m} />)}
              <div ref={fondo} />
            </div>
          </div>

          {ultimaNota && conversacion.estado === "necesita_atencion" && (
            <details className="border-t px-4 py-2 text-sm">
              <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                ¿Por qué no respondió el agente? {motivoDeDerivacion(ultimaNota) ? `(${motivoDeDerivacion(ultimaNota)})` : ""}
              </summary>
              <div className="max-h-56 overflow-y-auto">
                <Traza mensaje={ultimaNota} />
              </div>
            </details>
          )}

          <form
            className="flex items-end gap-2 border-t bg-[#f0f2f5] px-3 py-2.5 dark:bg-[#202c33]"
            onSubmit={(e) => {
              e.preventDefault();
              responder();
            }}
          >
            <Textarea
              value={respuesta}
              rows={1}
              placeholder="Responder como asesor"
              aria-label="Respuesta del asesor"
              onChange={(e) => setRespuesta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  responder();
                }
              }}
              className="bg-background max-h-32 min-h-9 resize-none rounded-2xl"
            />
            <Button
              type="submit"
              size="icon-lg"
              aria-label="Enviar respuesta"
              disabled={ocupado || !respuesta.trim()}
              className="shrink-0 rounded-full bg-[#00a884] text-white hover:bg-[#008f72]"
            >
              <SendHorizontal />
            </Button>
          </form>
        </section>
      ) : (
        <section className="bg-card text-muted-foreground hidden h-[min(80vh,760px)] min-h-[480px] flex-col items-center justify-center gap-2 rounded-xl border text-sm lg:flex">
          <MessagesSquare className="size-8" aria-hidden />
          Elige una conversación para verla.
        </section>
      )}
    </div>
  );
}
