"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BotMessageSquare,
  FileText,
  Headset,
  Megaphone,
  Paperclip,
  RotateCcw,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { crearPrueba, eliminarPrueba, leerPrueba } from "@/app/(app)/agente-whatsapp/acciones";
import type { AnuncioConfigurado } from "@/lib/agente-whatsapp/ajustes";
import { ESTADOS_CONVERSACION, agenteResponde, type EstadoConversacion } from "@/lib/agente-whatsapp/estado";
import type { MensajePrueba, PruebaResumen } from "@/lib/agente-whatsapp/pruebas";
import { BUCKET_ADJUNTOS_CLIENTE, type AdjuntoCliente } from "@/lib/agente-whatsapp/tipos";
import { TIPOS_ADJUNTO } from "@/lib/cad/adjuntos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  filtrarArchivos,
  liberarVistaPrevia,
  subirAdjuntos,
  type AdjuntoLocal,
} from "@/components/disenos/adjuntos-navegador";
import { Burbuja, FONDO_CHAT, TarjetaAnuncio, Traza, esNotaDerivacion } from "./burbujas";
import { NuevaPrueba } from "./nueva-prueba";

const SUGERENCIAS = [
  "¿Cuánto está el acrílico cristal de 3 mm?",
  "¿Dónde están ubicados?",
  "¿Cómo puedo pagar?",
  "¿Me mandas el catálogo?",
  "Quiero cotizar unos cortes a medida",
];

const SUGERENCIA_ANUNCIO = "Hola, quiero más información";

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
  const [locales, setLocales] = useState<AdjuntoLocal[]>([]);
  const [enviando, setEnviando] = useState<{ texto: string; locales: AdjuntoLocal[] } | null>(null);
  const [fallido, setFallido] = useState<{ texto: string; adjuntos: AdjuntoCliente[]; error: string } | null>(null);
  const [inspeccionado, setInspeccionado] = useState<string | null>(null);
  // El estado que devolvió el último envío, antes de que llegue el de la página.
  const [estados, setEstados] = useState<Record<string, EstadoConversacion>>({});
  const [arrastrando, setArrastrando] = useState(false);
  const [borrando, iniciarBorrado] = useTransition();
  const fondo = useRef<HTMLDivElement>(null);
  const selector = useRef<HTMLInputElement>(null);
  // La prueba abierta, para descartar lo que llegue tarde de otra.
  const abierta = useRef<string | null>(inicial);

  const prueba = pruebas.find((p) => p.id === activa) ?? null;
  const estado: EstadoConversacion = (activa && estados[activa]) || prueba?.estado || "agente";
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

  const agregar = (archivos: File[]) => {
    if (archivos.length === 0) return;
    const { agregados, avisos } = filtrarArchivos(archivos, locales.length);
    for (const a of avisos) toast.warning(a);
    setLocales((l) => [...l, ...agregados]);
  };

  const quitar = (id: string) =>
    setLocales((l) => {
      const fuera = l.find((a) => a.id === id);
      if (fuera) liberarVistaPrevia(fuera);
      return l.filter((a) => a.id !== id);
    });

  /** Manda el mensaje: sube los adjuntos (si hay) y pide la respuesta. `subidos` es para reintentar. */
  const enviar = async (contenido: string, subidos?: AdjuntoCliente[]) => {
    const limpio = contenido.trim();
    const aSubir = subidos ? [] : locales;
    if ((!limpio && aSubir.length === 0 && !subidos?.length) || enviando) return;
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
    setLocales([]);
    setFallido(null);
    setEnviando({ texto: limpio, locales: aSubir });
    let adjuntos = subidos ?? [];
    try {
      if (aSubir.length) adjuntos = await subirAdjuntos(pruebaId, aSubir, BUCKET_ADJUNTOS_CLIENTE);
      const respuesta = await fetch("/api/agente-whatsapp/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pruebaId, texto: limpio, adjuntos }),
      });
      const json = (await respuesta.json().catch(() => ({}))) as {
        cliente?: MensajePrueba;
        agente?: MensajePrueba | null;
        estado?: EstadoConversacion;
        error?: string;
      };
      if (!respuesta.ok || !json.cliente) {
        setFallido({ texto: limpio, adjuntos, error: json.error ?? "El agente no respondió." });
        return;
      }
      setMensajes((m) => [...m, json.cliente!, ...(json.agente ? [json.agente] : [])]);
      if (json.agente) setInspeccionado(json.agente.id);
      if (json.estado) setEstados((e) => ({ ...e, [pruebaId]: json.estado! }));
      router.refresh();
    } catch (e) {
      setFallido({
        texto: limpio,
        adjuntos,
        error: e instanceof Error && aSubir.length && !adjuntos.length ? e.message : "No hay conexión con el servidor.",
      });
    } finally {
      for (const a of aSubir) liberarVistaPrevia(a);
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
  const responde = agenteResponde(estado === "resuelta" ? "agente" : estado);
  const pendiente: MensajePrueba | null = enviando
    ? {
        id: "pendiente",
        rol: "cliente",
        contenido: enviando.texto,
        adjuntos: [],
        adjuntosCliente: enviando.locales.map((l) => ({
          ruta: l.id,
          nombre: l.archivo.name,
          mime: l.archivo.type as AdjuntoCliente["mime"],
          tamano: l.archivo.size,
          url: l.vistaPrevia ?? undefined,
        })),
        traza: [],
        derivado: false,
        autorId: null,
        creadoEn: new Date().toISOString(),
      }
    : null;

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
          {pruebas.map((p) => {
            const estadoP = estados[p.id] ?? p.estado;
            return (
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
                    {estadoP === "necesita_atencion" && (
                      <Headset className="size-3 text-amber-600" aria-label="Necesita atención" />
                    )}
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
            );
          })}
          {pruebas.length === 0 && (
            <li className="text-muted-foreground px-2.5 py-2 text-xs">Aún no hay pruebas. Escribe un mensaje para empezar.</li>
          )}
        </ul>
      </aside>

      {/* ── El chat ── */}
      <section
        className={cn(
          "bg-card flex h-[min(78vh,720px)] min-h-[480px] flex-col overflow-hidden rounded-xl border",
          arrastrando && "ring-primary ring-2",
        )}
        onDragOver={(e) => {
          if (!configurado) return;
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          if (configurado) agregar(Array.from(e.dataTransfer.files));
        }}
      >
        <header className="flex items-center gap-3 border-b bg-[#f0f2f5] px-4 py-2.5 dark:bg-[#202c33]">
          <span className="flex size-9 items-center justify-center rounded-full bg-[#25d366] text-white">
            <BotMessageSquare className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Plexiacril</p>
            <p className="text-muted-foreground truncate text-xs">
              {enviando && responde ? "escribiendo…" : "Agente de ventas · área de pruebas"}
            </p>
          </div>
        </header>

        {activa && !responde && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs">
            <Headset className="size-4 text-amber-600" aria-hidden />
            <span className="font-medium">{ESTADOS_CONVERSACION[estado]}</span>
            <span className="text-muted-foreground">
              El agente no responderá aquí hasta que un asesor la devuelva al agente.
            </span>
            <Link href={`/conversaciones?c=${activa}`} className="text-primary ml-auto underline-offset-4 hover:underline">
              Atender en Conversaciones
            </Link>
          </div>
        )}

        <div className={cn("flex-1 overflow-y-auto px-3 py-4 sm:px-6", FONDO_CHAT)}>
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            {prueba?.anuncio && <TarjetaAnuncio anuncio={prueba.anuncio} anuncios={anuncios} />}
            {cargando && <p className="text-muted-foreground py-8 text-center text-sm">Abriendo…</p>}
            {vacia && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-muted-foreground max-w-sm text-sm">
                  Escribe como lo haría un cliente, o adjunta una foto o un PDF. El agente solo responde lo que sabe;
                  lo demás lo deja a un asesor.
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
            {pendiente && (
              <>
                <Burbuja mensaje={pendiente} />
                {responde && (
                  <div className="bg-background w-fit rounded-lg rounded-tl-none px-3 py-2 shadow-sm dark:bg-[#202c33]">
                    <span className="text-muted-foreground inline-flex gap-1" aria-label="El agente está escribiendo">
                      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-current" />
                    </span>
                  </div>
                )}
              </>
            )}
            {fallido && (
              <div className="border-destructive/30 bg-background flex items-start gap-2 self-center rounded-lg border px-3 py-2 text-sm">
                <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="flex flex-col gap-1.5">
                  <p>{fallido.error}</p>
                  <Button
                    size="xs"
                    variant="outline"
                    className="w-fit"
                    onClick={() => enviar(fallido.texto, fallido.adjuntos)}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Reintentar
                  </Button>
                </div>
              </div>
            )}
            <div ref={fondo} />
          </div>
        </div>

        {locales.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto border-t bg-[#f0f2f5] px-3 pt-2.5 dark:bg-[#202c33]">
            {locales.map((a) => (
              <li key={a.id} className="bg-background relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                {a.vistaPrevia ? (
                  // eslint-disable-next-line @next/next/no-img-element -- vista previa local de un blob
                  <img src={a.vistaPrevia} alt={a.archivo.name} className="size-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-0.5 px-1 text-center">
                    <FileText className="size-5 text-red-500" aria-hidden />
                    <span className="line-clamp-1 text-[10px]">{a.archivo.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Quitar «${a.archivo.name}»`}
                  onClick={() => quitar(a.id)}
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex items-end gap-2 border-t bg-[#f0f2f5] px-3 py-2.5 dark:bg-[#202c33]"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Adjuntar foto o PDF"
            disabled={!configurado || Boolean(enviando)}
            onClick={() => selector.current?.click()}
            className="shrink-0 rounded-full"
          >
            <Paperclip />
          </Button>
          <input
            ref={selector}
            type="file"
            multiple
            hidden
            accept={TIPOS_ADJUNTO.join(",")}
            onChange={(e) => {
              agregar(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Textarea
            value={texto}
            rows={1}
            disabled={!configurado}
            placeholder={configurado ? "Escribe un mensaje como cliente" : "Falta la clave del agente (ver arriba)"}
            aria-label="Mensaje del cliente"
            onChange={(e) => setTexto(e.target.value)}
            onPaste={(e) => {
              const archivos = Array.from(e.clipboardData.files);
              if (archivos.length) {
                e.preventDefault();
                agregar(archivos);
              }
            }}
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
            disabled={!configurado || (!texto.trim() && locales.length === 0) || Boolean(enviando)}
            className="shrink-0 rounded-full bg-[#00a884] text-white hover:bg-[#008f72]"
          >
            <SendHorizontal />
          </Button>
        </form>
      </section>

      {/* ── Por qué respondió esto ── */}
      <aside className="bg-card h-fit rounded-xl border lg:col-span-2 xl:col-span-1">
        <header className="bg-muted/40 border-b px-4 py-3">
          <h2 className="text-sm font-medium">
            {mensajeInspeccionado && esNotaDerivacion(mensajeInspeccionado)
              ? "¿Por qué no respondió?"
              : "¿Por qué respondió esto?"}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Lo que consultó el agente para la respuesta elegida. Toca otra respuesta del chat para verla.
          </p>
        </header>
        <Traza mensaje={mensajeInspeccionado} />
      </aside>
    </div>
  );
}
