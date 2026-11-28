"use client";

import { FileText, Headset, Megaphone } from "lucide-react";
import type { AnuncioConfigurado } from "@/lib/agente-whatsapp/ajustes";
import type { MensajePrueba } from "@/lib/agente-whatsapp/pruebas";
import type { Anuncio, PasoTraza } from "@/lib/agente-whatsapp/tipos";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TextoWhatsApp } from "./texto-whatsapp";

/**
 * Cómo se ve una conversación del agente, con aspecto de WhatsApp desde el
 * teléfono del cliente: lo suyo a la derecha (verde), lo del negocio —agente o
 * asesor— a la izquierda. Lo comparten el área de pruebas y /conversaciones.
 */

export const NOMBRES_HERRAMIENTA: Record<string, string> = {
  buscar_precios: "Lista de precios",
  buscar_informacion: "Catálogos y fichas",
  datos_empresa: "Datos de la empresa",
  listar_archivos: "Archivos para enviar",
  enviar_archivo: "Enviar archivo",
  derivar_a_asesor: "Pasar a un asesor",
  motor: "Agente",
};

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });

/** El fondo del chat. */
export const FONDO_CHAT = "bg-[#efeae2] dark:bg-[#0b141a]";

const CLIENTE = "self-end rounded-tr-none bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]";
const NEGOCIO = "self-start rounded-tl-none bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]";

/** El motivo por el que el agente pasó la conversación a un asesor, de su traza. */
export function motivoDeDerivacion(mensaje: MensajePrueba): string | null {
  const paso = mensaje.traza.find((p) => p.herramienta === "derivar_a_asesor" || p.herramienta === "motor");
  const motivo = paso?.argumentos.motivo;
  if (typeof motivo === "string" && motivo.trim()) return motivo.trim();
  return paso ? paso.resumen : null;
}

/** Si el mensaje es la nota "el agente pasó a un asesor" y no una burbuja. */
export const esNotaDerivacion = (m: MensajePrueba) =>
  m.rol === "agente" && m.derivado && !m.contenido.trim() && m.adjuntos.length === 0;

export function TarjetaAnuncio({ anuncio, anuncios }: { anuncio: Anuncio; anuncios: AnuncioConfigurado[] }) {
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
            {configurado ? ` · ${configurado.nombre}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

/** Una foto o un PDF dentro de una burbuja. */
function Archivo({ nombre, mime, url, texto }: { nombre: string; mime: string; url?: string; texto?: string }) {
  return (
    <div className="flex flex-col">
      {mime.startsWith("image/") && url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, vence en una hora */}
          <img src={url} alt={nombre} className="max-h-72 w-full max-w-xs rounded-md object-cover" />
        </a>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2.5 dark:bg-white/5"
        >
          <FileText className="size-8 shrink-0 text-red-500" aria-hidden />
          <span className="line-clamp-2 text-sm">{nombre}</span>
        </a>
      )}
      {texto && (
        <p className="px-2 pt-1 pb-0.5">
          <TextoWhatsApp texto={texto} />
        </p>
      )}
      {!url && <p className="px-2 py-1 text-xs opacity-60">El archivo ya no existe.</p>}
    </div>
  );
}

/**
 * Un mensaje de la conversación. Los del agente se pueden elegir (`alElegir`)
 * para ver su traza; la nota de derivación también.
 */
export function Burbuja({
  mensaje,
  elegido = false,
  alElegir,
}: {
  mensaje: MensajePrueba;
  elegido?: boolean;
  alElegir?: () => void;
}) {
  const pie = <span className="float-right mt-1.5 ml-3 text-[11px] leading-none opacity-60">{hora(mensaje.creadoEn)}</span>;
  const elegible = mensaje.rol === "agente" && alElegir;
  const envoltura = (hijos: React.ReactNode, clase?: string) =>
    elegible ? (
      <div
        role="button"
        tabIndex={0}
        onClick={alElegir}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && alElegir?.()}
        aria-label="Ver qué consultó el agente para esta respuesta"
        className={cn(
          "flex max-w-[85%] cursor-pointer flex-col gap-1 rounded-lg outline-none",
          elegido && "ring-primary/60 ring-2 ring-offset-2 ring-offset-transparent",
          clase,
        )}
      >
        {hijos}
      </div>
    ) : (
      <div className={cn("flex max-w-[85%] flex-col gap-1", clase)}>{hijos}</div>
    );

  if (esNotaDerivacion(mensaje)) {
    const motivo = motivoDeDerivacion(mensaje);
    return envoltura(
      <span className="bg-background/80 text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs shadow-sm dark:bg-[#202c33]/80">
        <Headset className="size-3.5 shrink-0" aria-hidden />
        El agente no respondió y la pasó a un asesor{motivo ? `: ${motivo}` : ""} · {hora(mensaje.creadoEn)}
      </span>,
      "self-center items-center",
    );
  }

  if (mensaje.rol === "cliente") {
    return (
      <div className={cn("flex max-w-[85%] flex-col gap-1 rounded-lg px-1.5 py-1.5 text-sm shadow-sm", CLIENTE)}>
        {mensaje.adjuntosCliente.map((a) => (
          <Archivo key={a.ruta} nombre={a.nombre} mime={a.mime} url={a.url} />
        ))}
        {mensaje.contenido && (
          <div className="px-1.5">
            <span className="break-words whitespace-pre-wrap">{mensaje.contenido}</span>
            {pie}
          </div>
        )}
        {!mensaje.contenido && <div className="px-1.5">{pie}</div>}
      </div>
    );
  }

  const esAsesor = mensaje.rol === "asesor";
  const etiqueta = esAsesor ? `Asesor${mensaje.autorNombre ? ` · ${mensaje.autorNombre}` : ""}` : "Agente";
  return envoltura(
    <>
      {(mensaje.contenido || mensaje.adjuntos.length > 0) && (
        <div className={cn("rounded-lg px-3 py-1.5 text-sm shadow-sm", NEGOCIO)}>
          <p
            className={cn(
              "mb-0.5 text-[11px] font-medium",
              esAsesor ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {etiqueta}
          </p>
          {mensaje.contenido && (
            <span className="break-words">
              <TextoWhatsApp texto={mensaje.contenido} />
            </span>
          )}
          {pie}
        </div>
      )}
      {mensaje.adjuntosCliente.map((a) => (
        <div key={a.ruta} className={cn("rounded-lg p-1 text-sm shadow-sm", NEGOCIO)}>
          <Archivo nombre={a.nombre} mime={a.mime} url={a.url} />
        </div>
      ))}
      {mensaje.adjuntos.map((a) => (
        <div key={a.documentoId} className={cn("rounded-lg p-1 text-sm shadow-sm", NEGOCIO)}>
          <Archivo nombre={a.nombre} mime={a.mime} url={a.url} texto={a.texto} />
        </div>
      ))}
    </>,
    "self-start",
  );
}

/** Lo que consultó el agente para un mensaje: el panel "¿Por qué respondió esto?". */
export function Traza({ mensaje }: { mensaje: MensajePrueba | null }) {
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
