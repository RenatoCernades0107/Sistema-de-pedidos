"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BotMessageSquare,
  FileText,
  Headset,
  Megaphone,
  RotateCcw,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { crearPrueba, eliminarPrueba, leerPrueba } from "@/app/(app)/agente-whatsapp/acciones";
import type { AnuncioConfigurado } from "@/lib/agente-whatsapp/ajustes";
import type { MensajePrueba, PruebaResumen } from "@/lib/agente-whatsapp/pruebas";
import type { Anuncio, PasoTraza } from "@/lib/agente-whatsapp/tipos";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NuevaPrueba } from "./nueva-prueba";
import { TextoWhatsApp } from "./texto-whatsapp";

const SUGERENCIAS = [
  "¿Cuánto está el acrílico cristal de 3 mm?",
  "¿Dónde están ubicados?",
  "¿Cómo puedo pagar?",
  "¿Me mandas el catálogo?",
  "Quiero cotizar unos cortes a medida",
];

const SUGERENCIA_ANUNCIO = "Hola, quiero más información";

const NOMBRES_HERRAMIENTA: Record<string, string> = {
  buscar_precios: "Lista de precios",
  buscar_informacion: "Catálogos y fichas",
  datos_empresa: "Datos de la empresa",
  listar_archivos: "Archivos para enviar",
  enviar_archivo: "Enviar archivo",
  derivar_a_asesor: "Pasar a un asesor",
  motor: "Agente",
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "America/Lima" });

/**
 * El área de pruebas: conversaciones guardadas a la izquierda, el chat con
 * aspecto de WhatsApp al centro (tú eres el cliente) y, a la derecha, qué
 * consultó el agente para responder el mensaje elegido.
 */
export function ProbarAgente({
  pruebas,
  anuncios,
  configurado,
}: {
  pruebas: PruebaResumen[];
  anuncios: AnuncioConfigurado[];
  configurado: boolean;
}) {
  const router = useRouter();
  const inicial = pruebas[0]?.id ?? null;
  const [activa, setActiva] = useState<string | null>(inicial);
  const [mensajes, setMensajes] = useState<MensajePrueba[]>([]);
  const [cargando, setCargando] = useState(inicial !== null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [fallido, setFallido] = useState<{ texto: string; error: string } | null>(null);
  const [inspeccionado, setInspeccionado] = useState<string | null>(null);
  const [borrando, iniciarBorrado] = useTransition();
  const fondo = useRef<HTMLDivElement>(null);
  // La prueba abierta, para descartar lo que llegue tarde de otra.
  const abierta = useRef<string | null>(inicial);

  const prueba = pruebas.find((p) => p.id === activa) ?? null;
  const mensajeInspeccionado =
    mensajes.find((m) => m.id === inspeccionado) ?? [...mensajes].reverse().find((m) => m.rol === "agente") ?? null;

  const cargar = (id: string) =>
    leerPrueba(id).then((r) => {
      if (abierta.current !== id) return;
      setCargando(false);
      if (r.ok) setMensajes(r.mensajes);
      else toast.error("No se abrió la prueba", { description: r.error });
    });

  const abrir = (id: string | null) => {
    abierta.current = id;
    setActiva(id);
    setMensajes([]);
    setFallido(null);
    setInspeccionado(null);
    setCargando(id !== null);
    if (id) cargar(id);
  };

  useEffect(() => {
    if (inicial) cargar(inicial);
    // Solo al montar: después, cada cambio de prueba pasa por `abrir`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fondo.current?.scrollIntoView({ block: "end" });
  }, [mensajes, enviando, fallido]);

  const enviar = async (contenido: string) => {
    const limpio = contenido.trim();
    if (!limpio || enviando) return;
    let pruebaId = activa;
    if (!pruebaId) {
      const r = await crearPrueba({ anuncio: null });
      if (!r.ok) {
        toast.error("No se creó la prueba", { description: r.error });
        return;
      }
      pruebaId = r.id;
      abierta.current = r.id;
      setActiva(r.id);
    }
    setTexto("");
    setFallido(null);
    setEnviando(limpio);
    try {
      const respuesta = await fetch("/api/agente-whatsapp/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pruebaId, texto: limpio }),
      });
      const json = (await respuesta.json().catch(() => ({}))) as {
        cliente?: MensajePrueba;
        agente?: MensajePrueba;
        error?: string;
      };
      if (!respuesta.ok || !json.cliente || !json.agente) {
        setFallido({ texto: limpio, error: json.error ?? "El agente no respondió." });
        return;
      }
      setMensajes((m) => [...m, json.cliente!, json.agente!]);
      setInspeccionado(json.agente.id);
      router.refresh();
    } catch {
      setFallido({ texto: limpio, error: "No hay conexión con el servidor." });
    } finally {
      setEnviando(null);
    }
  };

  const borrar = (id: string) =>
    iniciarBorrado(async () => {
      const r = await eliminarPrueba(id);
      if (!r.ok) {
        toast.error("No se borró la prueba", { description: r.error });
        return;
      }
      if (activa === id) abrir(pruebas.find((p) => p.id !== id)?.id ?? null);
    });

  const vacia = !cargando && mensajes.length === 0 && !enviando;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
      {/* ── Las pruebas ── */}
      <aside className="flex flex-col gap-2">
        <NuevaPrueba
          anuncios={anuncios}
          alCrear={(id) => {
            abrir(id);
            router.refresh();
          }}
        />
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto lg:max-h-[min(70vh,640px)]">
          {pruebas.map((p) => (
            <li key={p.id} className="group relative">
              <button
                type="button"
                onClick={() => p.id !== activa && abrir(p.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 pr-8 text-left text-sm transition-colors",
                  activa === p.id ? "bg-muted font-medium" : "hover:bg-muted/60",
                )}
              >
                <span className="line-clamp-1">{p.titulo}</span>
                <span className="text-muted-foreground flex items-center gap-1 text-xs font-normal">
                  {p.anuncio && <Megaphone className="size-3" aria-label="Desde un anuncio" />}
                  {fechaCorta(p.actualizadoEn)}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Borrar «${p.titulo}»`}
                disabled={borrando}
                onClick={() => borrar(p.id)}
                className="absolute top-2 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 />
              </Button>
            </li>
          ))}
          {pruebas.length === 0 && (
            <li className="text-muted-foreground px-2.5 py-2 text-xs">Aún no hay pruebas. Escribe un mensaje para empezar.</li>
          )}
        </ul>
      </aside>

      {/* ── El chat ── */}
      <section className="bg-card flex h-[min(78vh,720px)] min-h-[480px] flex-col overflow-hidden rounded-xl border">
        <header className="flex items-center gap-3 border-b bg-[#f0f2f5] px-4 py-2.5 dark:bg-[#202c33]">
          <span className="flex size-9 items-center justify-center rounded-full bg-[#25d366] text-white">
            <BotMessageSquare className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Plexiacril</p>
            <p className="text-muted-foreground truncate text-xs">
              {enviando ? "escribiendo…" : "Agente de ventas · área de pruebas"}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-[#efeae2] px-3 py-4 sm:px-6 dark:bg-[#0b141a]">
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            {prueba?.anuncio && <TarjetaAnuncio anuncio={prueba.anuncio} anuncios={anuncios} />}
            {cargando && <p className="text-muted-foreground py-8 text-center text-sm">Abriendo…</p>}
            {vacia && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-muted-foreground max-w-sm text-sm">
                  Escribe como lo haría un cliente. El agente responde con la lista de precios, los catálogos que
                  subiste y los datos de la empresa.
                </p>
                <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                  {(prueba?.anuncio ? [SUGERENCIA_ANUNCIO, ...SUGERENCIAS] : SUGERENCIAS).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!configurado}
                      onClick={() => enviar(s)}
                      className="bg-background hover:bg-muted rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mensajes.map((m) => (
              <Burbuja
                key={m.id}
                mensaje={m}
                elegido={m.rol === "agente" && mensajeInspeccionado?.id === m.id}
                alElegir={() => setInspeccionado(m.id)}
              />
            ))}
            {enviando && (
              <>
                <Burbuja mensaje={{ id: "pendiente", rol: "cliente", contenido: enviando, adjuntos: [], traza: [], derivado: false, creadoEn: new Date().toISOString() }} />
                <div className="bg-background w-fit rounded-lg rounded-tl-none px-3 py-2 shadow-sm dark:bg-[#202c33]">
                  <span className="text-muted-foreground inline-flex gap-1" aria-label="El agente está escribiendo">
                    <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-current" />
                  </span>
                </div>
              </>
            )}
            {fallido && (
              <div className="border-destructive/30 bg-background flex items-start gap-2 self-center rounded-lg border px-3 py-2 text-sm">
                <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="flex flex-col gap-1.5">
                  <p>{fallido.error}</p>
                  <Button size="xs" variant="outline" className="w-fit" onClick={() => enviar(fallido.texto)}>
                    <RotateCcw data-icon="inline-start" />
                    Reintentar
                  </Button>
                </div>
              </div>
            )}
            <div ref={fondo} />
          </div>
        </div>

        <form
          className="flex items-end gap-2 border-t bg-[#f0f2f5] px-3 py-2.5 dark:bg-[#202c33]"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
        >
          <Textarea
            value={texto}
            rows={1}
            disabled={!configurado}
            placeholder={configurado ? "Escribe un mensaje como cliente" : "Falta la clave del agente (ver arriba)"}
            aria-label="Mensaje del cliente"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                enviar(texto);
              }
            }}
            className="bg-background max-h-32 min-h-9 resize-none rounded-2xl"
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Enviar"
            disabled={!configurado || !texto.trim() || Boolean(enviando)}
            className="shrink-0 rounded-full bg-[#00a884] text-white hover:bg-[#008f72]"
          >
            <SendHorizontal />
          </Button>
        </form>
      </section>

      {/* ── Por qué respondió esto ── */}
      <aside className="bg-card h-fit rounded-xl border lg:col-span-2 xl:col-span-1">
        <header className="bg-muted/40 border-b px-4 py-3">
          <h2 className="text-sm font-medium">¿Por qué respondió esto?</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Lo que consultó el agente para la respuesta elegida. Toca otra respuesta del chat para verla.
          </p>
        </header>
        <Traza mensaje={mensajeInspeccionado} />
      </aside>
    </div>
  );
}

function TarjetaAnuncio({ anuncio, anuncios }: { anuncio: Anuncio; anuncios: AnuncioConfigurado[] }) {
  const configurado = anuncio.sourceId ? anuncios.find((a) => a.sourceId === anuncio.sourceId) : undefined;
  return (
    <div className="bg-background mx-auto mb-2 w-full max-w-sm overflow-hidden rounded-lg border text-sm shadow-sm dark:bg-[#202c33]">
      <div className="bg-muted/60 text-muted-foreground flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <Megaphone className="size-3.5" aria-hidden />
        El cliente llegó desde un anuncio
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <p className="font-medium">{anuncio.titulo || configurado?.nombre || "Anuncio de Meta"}</p>
        {anuncio.texto && <p className="text-muted-foreground text-xs">{anuncio.texto}</p>}
        {anuncio.sourceId && (
          <p className="text-muted-foreground text-xs">
            ID {anuncio.sourceId}
            {configurado ? ` · ${configurado.nombre}` : " · sin contexto en Ajustes"}
          </p>
        )}
      </div>
    </div>
  );
}

function Burbuja({
  mensaje,
  elegido = false,
  alElegir,
}: {
  mensaje: MensajePrueba;
  elegido?: boolean;
  alElegir?: () => void;
}) {
  const delCliente = mensaje.rol === "cliente";
  const clases = cn(
    "max-w-[85%] rounded-lg px-3 py-1.5 text-sm shadow-sm",
    delCliente
      ? "self-end rounded-tr-none bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]"
      : "self-start rounded-tl-none bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]",
  );
  const pie = (
    <span className="ml-3 float-right mt-1.5 text-[11px] leading-none opacity-60">{hora(mensaje.creadoEn)}</span>
  );

  if (delCliente) {
    return (
      <div className={clases}>
        <span className="break-words whitespace-pre-wrap">{mensaje.contenido}</span>
        {pie}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={alElegir}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && alElegir?.()}
      className={cn("flex max-w-[85%] cursor-pointer flex-col gap-1.5 self-start rounded-lg outline-none", elegido && "ring-primary/60 ring-2 ring-offset-2 ring-offset-transparent")}
      aria-label="Ver qué consultó el agente para esta respuesta"
    >
      {mensaje.contenido && (
        <div className={cn(clases, "max-w-full")}>
          <span className="break-words">
            <TextoWhatsApp texto={mensaje.contenido} />
          </span>
          {pie}
        </div>
      )}
      {mensaje.adjuntos.map((a) => (
        <div key={a.documentoId} className={cn(clases, "max-w-full p-1")}>
          {a.mime.startsWith("image/") && a.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, vence en una hora
            <img src={a.url} alt={a.nombre} className="max-h-72 w-full max-w-xs rounded-md object-cover" />
          ) : (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2.5 dark:bg-white/5"
            >
              <FileText className="size-8 shrink-0 text-red-500" aria-hidden />
              <span className="line-clamp-2 text-sm">{a.nombre}</span>
            </a>
          )}
          {a.texto && (
            <p className="px-2 pt-1 pb-0.5">
              <TextoWhatsApp texto={a.texto} />
            </p>
          )}
          {!a.url && <p className="text-muted-foreground px-2 py-1 text-xs">El archivo ya no existe.</p>}
        </div>
      ))}
      {mensaje.derivado && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Headset className="size-3.5" aria-hidden />
          Pasó la conversación a un asesor
        </span>
      )}
    </div>
  );
}

function Traza({ mensaje }: { mensaje: MensajePrueba | null }) {
  if (!mensaje) {
    return <p className="text-muted-foreground p-4 text-sm">Cuando el agente responda, aquí verás qué consultó.</p>;
  }
  if (mensaje.traza.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Respondió sin consultar nada (un saludo, o algo que ya estaba en la conversación).
      </p>
    );
  }
  return (
    <ol className="flex flex-col divide-y">
      {mensaje.traza.map((p, i) => (
        <PasoDeTraza key={i} paso={p} />
      ))}
    </ol>
  );
}

function PasoDeTraza({ paso }: { paso: PasoTraza }) {
  const consulta = typeof paso.argumentos.consulta === "string" ? paso.argumentos.consulta : null;
  const motivo = typeof paso.argumentos.motivo === "string" ? paso.argumentos.motivo : null;
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{NOMBRES_HERRAMIENTA[paso.herramienta] ?? paso.herramienta}</span>
        {paso.error && <Badge variant="destructive">Error</Badge>}
      </div>
      {(consulta || motivo) && <p className="text-muted-foreground text-xs">«{consulta ?? motivo}»</p>}
      <p className="text-xs">{paso.resumen}</p>
      {paso.detalle !== undefined && paso.detalle !== null && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer select-none">Ver detalle</summary>
          <pre className="bg-muted mt-1.5 max-h-64 overflow-auto rounded-md p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            {JSON.stringify(paso.detalle, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}
