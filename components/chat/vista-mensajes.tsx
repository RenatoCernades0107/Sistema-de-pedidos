"use client";

/**
 * Los mensajes de una conversación: burbujas con separador de día, autor y rol
 * cuando cambia quien habla, la hora, los archivos dentro de la burbuja y, en
 * los propios, si ya los vieron (un check gris, o doble check azul cuando todos
 * a quienes iba lo vieron).
 *
 * "Info del mensaje" (el menú de la burbuja, o mantenerla apretada en el celular)
 * dice quién lo vio y a qué hora, y a quién le falta.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Ellipsis,
  FileText,
  Info,
  Loader2,
  Play,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ROLES } from "@/lib/dominio";
import { hoy, momentoEnLima } from "@/lib/fecha";
import { diaMesTexto } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { esImagen, esVideo, estadoDeEntrega, textoPlano, type Adjunto } from "@/lib/chat/tipos";
import { duracionTexto, horaCorta, infoDeLecturas, pesoTexto } from "@/lib/chat/logica";
import { TextoConReferencias } from "@/components/chat/referencias";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VisorArchivo } from "@/components/visor-archivo";
import type { Conversacion, MensajeVista } from "./use-conversacion";
import { useUrlFirmada } from "./urls-firmadas";

/** Lo que mide una pulsación larga en el celular. */
const PULSACION_LARGA_MS = 500;
/** Más cerca del fondo que esto, lo que llega baja la vista; más arriba, se respeta la lectura. */
const CERCA_DEL_FONDO_PX = 120;

interface ArchivoAbierto {
  ruta: string;
  nombre: string;
  mime: string;
}

export function VistaMensajes({
  chat,
  mostrarAutor = true,
  vacio,
  onRecuperar,
}: {
  chat: Conversacion;
  /** En un directo ya se sabe quién habla: no hace falta el nombre encima. */
  mostrarAutor?: boolean;
  /** Lo que se lee cuando todavía no hay mensajes. */
  vacio?: React.ReactNode;
  /** "Editar" un mensaje que no se envió: el compositor lo recibe de vuelta. */
  onRecuperar?: (localId: string) => void;
}) {
  const { mensajes, usuarioId } = chat;
  const lista = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState<ArchivoAbierto | null>(null);
  const [info, setInfo] = useState<MensajeVista | null>(null);

  /* Lo que había en la última pintura, para decidir a dónde va la vista: al
     fondo si llegó algo abajo (y se estaba leyendo abajo, o lo mandó uno), o en
     el mismo mensaje si se cargaron anteriores arriba. */
  const antes = useRef<{ alto: number; arriba: number; primero?: string; ultimo?: string; cerca: boolean } | null>(
    null,
  );

  useLayoutEffect(() => {
    const el = lista.current;
    if (!el) return;
    const primero = mensajes[0]?.id;
    const ultimo = mensajes.at(-1);
    const previo = antes.current;
    if (!previo) {
      el.scrollTop = el.scrollHeight;
    } else if (primero !== previo.primero && previo.primero && mensajes.some((m) => m.id === previo.primero)) {
      el.scrollTop = el.scrollHeight - previo.alto + previo.arriba;
    } else if (ultimo?.id !== previo.ultimo && (previo.cerca || ultimo?.autorId === usuarioId)) {
      el.scrollTop = el.scrollHeight;
    }
    antes.current = {
      alto: el.scrollHeight,
      arriba: el.scrollTop,
      primero,
      ultimo: ultimo?.id,
      cerca: el.scrollHeight - el.scrollTop - el.clientHeight < CERCA_DEL_FONDO_PX,
    };
  }, [mensajes, usuarioId]);

  const alDesplazar = () => {
    const el = lista.current;
    if (!el || !antes.current) return;
    antes.current.arriba = el.scrollTop;
    antes.current.alto = el.scrollHeight;
    antes.current.cerca = el.scrollHeight - el.scrollTop - el.clientHeight < CERCA_DEL_FONDO_PX;
  };

  const hoyLima = hoy();
  const cerrarVisor = useCallback(() => setAbierto(null), []);

  return (
    <>
      <div
        ref={lista}
        onScroll={alDesplazar}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-4 sm:px-4"
      >
        {chat.hayAnteriores && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground mb-3 self-center"
            onClick={() => void chat.cargarAnteriores()}
            disabled={chat.cargandoAnteriores}
          >
            {chat.cargandoAnteriores && <Loader2 className="animate-spin" />}
            Cargar anteriores
          </Button>
        )}

        {chat.cargando && mensajes.length === 0 && (
          <p className="text-muted-foreground m-auto flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Cargando mensajes…
          </p>
        )}
        {chat.error && <p className="text-destructive mb-2 self-center text-xs">{chat.error}</p>}
        {!chat.cargando && mensajes.length === 0 && (
          <div className="text-muted-foreground m-auto max-w-64 text-center text-sm">
            {vacio ?? "Todavía no hay mensajes. Escribe el primero."}
          </div>
        )}

        <ol className="flex flex-col gap-1" aria-live="polite">
          {mensajes.map((m, i) => {
            const mio = m.autorId === usuarioId;
            const momento = momentoEnLima(m.creadoEn);
            const anterior = mensajes[i - 1];
            const nuevoDia = !anterior || momentoEnLima(anterior.creadoEn).slice(0, 10) !== momento.slice(0, 10);
            const mismoAutor = !nuevoDia && anterior?.autorId === m.autorId;
            return (
              <li key={m.id} className={cn("flex flex-col", !mismoAutor && i > 0 && "mt-2")}>
                {nuevoDia && (
                  <p className="text-muted-foreground bg-muted/60 my-2 self-center rounded-full px-2.5 py-0.5 text-2xs">
                    {etiquetaDia(momento.slice(0, 10), hoyLima)}
                  </p>
                )}
                <Burbuja
                  chat={chat}
                  mensaje={m}
                  mio={mio}
                  hora={momento.slice(11, 16)}
                  conAutor={mostrarAutor && !mio && !mismoAutor}
                  onAbrir={setAbierto}
                  onInfo={() => setInfo(m)}
                  onRecuperar={onRecuperar}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <InfoMensaje chat={chat} mensaje={info} onCerrar={() => setInfo(null)} />
      {abierto && <VisorDeAdjunto archivo={abierto} onCerrar={cerrarVisor} />}
    </>
  );
}

function etiquetaDia(dia: string, hoyLima: string) {
  const corta = horaCorta(`${dia}T00:00`, hoyLima);
  if (dia === hoyLima) return "Hoy";
  if (corta === "ayer") return "Ayer";
  return diaMesTexto(dia);
}

function Burbuja({
  chat,
  mensaje: m,
  mio,
  hora,
  conAutor,
  onAbrir,
  onInfo,
  onRecuperar,
}: {
  chat: Conversacion;
  mensaje: MensajeVista;
  mio: boolean;
  hora: string;
  conAutor: boolean;
  onAbrir: (a: ArchivoAbierto) => void;
  onInfo: () => void;
  onRecuperar?: (localId: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const pulsacion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inicio = useRef({ x: 0, y: 0 });
  const local = m.local;
  const tieneArchivos = m.adjuntos.length > 0 || (local?.borrador.archivos.length ?? 0) > 0;

  const soltar = () => {
    if (pulsacion.current) clearTimeout(pulsacion.current);
    pulsacion.current = null;
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoPlano(m.texto, m.referencias));
      toast.success("Texto copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <div className={cn("group flex max-w-[85%] items-center gap-1", mio ? "flex-row-reverse self-end" : "self-start")}>
      <div className={cn("flex min-w-0 flex-col", mio ? "items-end" : "items-start")}>
        {conAutor && (
          <p className="text-muted-foreground mb-0.5 px-1 text-2xs">
            <span className="text-foreground font-medium">{m.autor}</span>
            {m.rol && ` · ${ROLES[m.rol].nombre}`}
          </p>
        )}
        <div
          // Mantener apretado en el celular abre el menú del mensaje.
          onPointerDown={(e) => {
            if (e.pointerType !== "touch" || local || !(m.texto || mio)) return;
            inicio.current = { x: e.clientX, y: e.clientY };
            pulsacion.current = setTimeout(() => {
              setMenu(true);
              navigator.vibrate?.(10);
            }, PULSACION_LARGA_MS);
          }}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onPointerMove={(e) => {
            // El dedo nunca está quieto del todo: solo un arrastre de verdad (desplazar) cancela.
            if (Math.hypot(e.clientX - inicio.current.x, e.clientY - inicio.current.y) > 10) soltar();
          }}
          onContextMenu={(e) => {
            // En el celular, el menú del sistema taparía el nuestro.
            if (pulsacion.current !== null || menu) e.preventDefault();
          }}
          className={cn(
            "max-w-full overflow-hidden rounded-2xl text-sm break-words whitespace-pre-wrap select-text",
            tieneArchivos ? "p-1" : "px-3 py-1.5",
            mio ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md",
            local?.estado === "error" && "opacity-70",
          )}
        >
          {local ? (
            <ArchivosLocales mensaje={m} />
          ) : (
            m.adjuntos.length > 0 && <Adjuntos adjuntos={m.adjuntos} mio={mio} onAbrir={onAbrir} />
          )}
          {!local && !m.texto && m.adjuntos.length === 0 && (
            // Llegó por Realtime antes que sus archivos.
            <span className="text-muted-foreground inline-flex items-center gap-1.5 px-2 py-1 text-xs">
              <Loader2 className="size-3 animate-spin" /> Archivo…
            </span>
          )}
          {m.texto && (
            <p className={cn(tieneArchivos && "px-2 pt-1 pb-0.5")}>
              <TextoConReferencias texto={m.texto} referencias={m.referencias} propio={mio} />
            </p>
          )}
        </div>
        <p className="text-muted-foreground tnum mt-0.5 flex items-center gap-1 px-1 text-2xs">
          {hora}
          {mio && <Entrega chat={chat} mensaje={m} />}
        </p>
        {local?.estado === "error" && (
          <div className="mt-0.5 flex flex-wrap items-center justify-end gap-1 text-2xs">
            <span className="text-destructive">{local.error ?? "No se envió."}</span>
            <Button size="xs" variant="ghost" onClick={() => chat.reintentar(m.id)}>
              <RotateCw /> Reintentar
            </Button>
            {onRecuperar && (
              <Button size="xs" variant="ghost" onClick={() => onRecuperar(m.id)}>
                Editar
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => chat.descartar(m.id)} aria-label="Descartar">
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      {!local && (m.texto || mio) && (
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:pointer-events-none"
                aria-label="Opciones del mensaje"
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mio ? "end" : "start"} className="w-44">
            {m.texto && (
              <DropdownMenuItem onClick={() => void copiar()}>
                <Copy /> Copiar texto
              </DropdownMenuItem>
            )}
            {mio && (
              <DropdownMenuItem onClick={onInfo}>
                <Info /> Info del mensaje
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** El reloj mientras sale, y el check (gris) o doble check (azul) después. */
function Entrega({ chat, mensaje: m }: { chat: Conversacion; mensaje: MensajeVista }) {
  if (m.local) {
    return m.local.estado === "error" ? (
      <AlertCircle className="text-destructive size-3" aria-label="No se envió" />
    ) : (
      <Clock className="size-3" aria-label="Enviando" />
    );
  }
  const estado = estadoDeEntrega(m, chat.participantes, chat.lecturas);
  return estado === "visto" ? (
    <CheckCheck className="size-3.5 text-sky-500" aria-label="Visto por todos" />
  ) : (
    <Check className="size-3.5" aria-label="Enviado" />
  );
}

// ── Archivos ──

function Adjuntos({
  adjuntos,
  mio,
  onAbrir,
}: {
  adjuntos: Adjunto[];
  mio: boolean;
  onAbrir: (a: ArchivoAbierto) => void;
}) {
  const imagenes = adjuntos.filter((a) => esImagen(a.mime));
  const videos = adjuntos.filter((a) => esVideo(a.mime));
  const otros = adjuntos.filter((a) => !esImagen(a.mime) && !esVideo(a.mime));
  const abrir = (a: Adjunto) => onAbrir({ ruta: a.ruta, nombre: a.nombre, mime: a.mime });

  return (
    <div className="flex flex-col gap-1">
      {imagenes.length === 1 && <Miniatura adjunto={imagenes[0]} sola onAbrir={() => abrir(imagenes[0])} />}
      {imagenes.length > 1 && (
        <div className="grid w-64 max-w-full grid-cols-2 gap-1 sm:w-72">
          {imagenes.map((a) => (
            <Miniatura key={a.id} adjunto={a} onAbrir={() => abrir(a)} />
          ))}
        </div>
      )}
      {videos.map((a) => (
        <Video key={a.id} adjunto={a} />
      ))}
      {otros.map((a) => (
        <Ficha key={a.id} nombre={a.nombre} detalle={pesoTexto(a.tamano)} mio={mio} onAbrir={() => abrir(a)} />
      ))}
    </div>
  );
}

function Miniatura({ adjunto: a, sola, onAbrir }: { adjunto: Adjunto; sola?: boolean; onAbrir: () => void }) {
  const url = useUrlFirmada(a.ruta);
  const [roto, setRoto] = useState(false);
  // Con las medidas guardadas se reserva el lugar y la burbuja no salta al cargar.
  const proporcion = a.ancho && a.alto ? `${a.ancho} / ${a.alto}` : "4 / 3";

  if (roto || url === null) {
    // Una foto HEIC fuera de Safari, o una URL que no se pudo firmar: se ofrece abrirla.
    return <Ficha nombre={a.nombre} detalle={`Foto · ${pesoTexto(a.tamano)}`} onAbrir={onAbrir} />;
  }

  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "bg-muted-foreground/10 block overflow-hidden rounded-xl focus-visible:ring-2 focus-visible:outline-none",
        sola ? "w-64 max-w-full sm:w-72" : "aspect-square w-full",
      )}
      style={sola ? { aspectRatio: proporcion, maxHeight: "22rem" } : undefined}
      aria-label={`Ver ${a.nombre}`}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, vence en una hora
        <img
          src={url}
          alt={a.nombre}
          loading="lazy"
          onError={() => setRoto(true)}
          className="size-full object-cover"
        />
      )}
    </button>
  );
}

function Video({ adjunto: a }: { adjunto: Adjunto }) {
  const url = useUrlFirmada(a.ruta);
  const proporcion = a.ancho && a.alto ? `${a.ancho} / ${a.alto}` : "16 / 9";
  return (
    <div
      className="relative w-64 max-w-full overflow-hidden rounded-xl bg-black sm:w-72"
      style={{ aspectRatio: proporcion, maxHeight: "24rem" }}
    >
      {url ? (
        <video src={url} controls preload="metadata" playsInline className="size-full object-contain" />
      ) : (
        <div className="grid size-full place-items-center text-white/70">
          {url === null ? <span className="text-xs">No se pudo cargar el video</span> : <Play className="size-6" />}
        </div>
      )}
      {a.duracionS != null && !url && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1 text-2xs text-white">
          {duracionTexto(a.duracionS)}
        </span>
      )}
    </div>
  );
}

function Ficha({
  nombre,
  detalle,
  mio,
  onAbrir,
}: {
  nombre: string;
  detalle: string;
  mio?: boolean;
  onAbrir?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      disabled={!onAbrir}
      className={cn(
        "flex w-64 max-w-full items-center gap-2.5 rounded-xl p-2 text-left focus-visible:ring-2 focus-visible:outline-none sm:w-72",
        mio ? "bg-primary-foreground/15" : "bg-background/70",
      )}
    >
      <span className="bg-background text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
        <FileText className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{nombre}</span>
        <span className="block text-2xs opacity-75">{detalle}</span>
      </span>
    </button>
  );
}

/** Lo que se está mandando: la vista previa local con el avance de cada archivo. */
function ArchivosLocales({ mensaje: m }: { mensaje: MensajeVista }) {
  const local = m.local!;
  if (local.borrador.archivos.length === 0) return null;
  return (
    <ul className="grid w-64 max-w-full grid-cols-2 gap-1 sm:w-72">
      {local.borrador.archivos.map((a) => {
        const progreso = local.archivos.find((x) => x.id === a.id);
        const porcentaje = Math.round((progreso?.avance ?? 0) * 100);
        return (
          <li
            key={a.id}
            className={cn(
              "bg-muted-foreground/20 relative aspect-square overflow-hidden rounded-xl",
              local.borrador.archivos.length === 1 && "col-span-2",
            )}
          >
            {a.vistaPrevia && esImagen(a.mime) ? (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa local de un blob
              <img src={a.vistaPrevia} alt="" className="size-full object-cover" />
            ) : a.vistaPrevia && esVideo(a.mime) ? (
              <video src={a.vistaPrevia} muted playsInline preload="metadata" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center p-2 text-center text-xs">
                <FileText className="mb-1 size-5" />
                <span className="line-clamp-2 break-all">{a.archivo.name}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-2xs text-white">
              {progreso?.estado === "error"
                ? "No se subió"
                : progreso?.estado === "listo"
                  ? "Subido"
                  : progreso?.estado === "subiendo"
                    ? `Subiendo… ${porcentaje}%`
                    : "En espera"}
              <div className="mt-0.5 h-0.5 overflow-hidden rounded bg-white/30">
                <div className="h-full bg-white transition-[width]" style={{ width: `${porcentaje}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function VisorDeAdjunto({ archivo, onCerrar }: { archivo: ArchivoAbierto; onCerrar: () => void }) {
  const url = useUrlFirmada(archivo.ruta);
  useEffect(() => {
    if (url !== null) return;
    toast.error("No se pudo abrir el archivo");
    onCerrar();
  }, [url, onCerrar]);
  if (!url) return null;
  return <VisorArchivo abierto url={url} titulo={archivo.nombre} mime={archivo.mime} onCerrar={onCerrar} />;
}

// ── Info del mensaje ──

function InfoMensaje({
  chat,
  mensaje,
  onCerrar,
}: {
  chat: Conversacion;
  mensaje: MensajeVista | null;
  onCerrar: () => void;
}) {
  const info = mensaje ? infoDeLecturas(mensaje, chat.participantes, chat.lecturas) : null;
  return (
    <Sheet open={mensaje !== null} onOpenChange={(v) => !v && onCerrar()}>
      <SheetContent side="bottom" className="mx-auto max-h-[80dvh] w-full max-w-lg gap-0 rounded-t-xl p-0">
        <SheetHeader className="border-b">
          <SheetTitle>Info del mensaje</SheetTitle>
          {mensaje && (
            <SheetDescription className="line-clamp-2">
              {textoPlano(mensaje.texto, mensaje.referencias) ||
                `${mensaje.adjuntos.length} archivo${mensaje.adjuntos.length === 1 ? "" : "s"}`}
            </SheetDescription>
          )}
        </SheetHeader>
        {info && (
          <div className="overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-sm">
            <h3 className="mb-2 flex items-center gap-1.5 font-medium">
              <CheckCheck className="size-4 text-sky-500" /> Visto por
            </h3>
            {info.vistoPor.length === 0 ? (
              <p className="text-muted-foreground mb-4 text-xs">Nadie todavía.</p>
            ) : (
              <ul className="mb-4 flex flex-col gap-1.5">
                {info.vistoPor.map(({ participante: p, leidoEn }) => {
                  const momento = momentoEnLima(leidoEn);
                  return (
                    <li key={p.usuarioId} className="flex items-baseline justify-between gap-3">
                      <span>
                        {p.nombre} <span className="text-muted-foreground text-xs">· {ROLES[p.rol].nombre}</span>
                      </span>
                      <span className="text-muted-foreground tnum text-xs">
                        {horaCorta(momento, hoy()) === momento.slice(11, 16)
                          ? momento.slice(11, 16)
                          : `${horaCorta(momento, hoy())} ${momento.slice(11, 16)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <h3 className="mb-2 flex items-center gap-1.5 font-medium">
              <Check className="text-muted-foreground size-4" /> Falta ver
            </h3>
            {info.faltan.length === 0 ? (
              <p className="text-muted-foreground text-xs">Lo vieron todos.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {info.faltan.map((p) => (
                  <li key={p.usuarioId}>
                    {p.nombre} <span className="text-muted-foreground text-xs">· {ROLES[p.rol].nombre}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
