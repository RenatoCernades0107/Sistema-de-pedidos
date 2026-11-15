"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TextoAgente } from "@/components/cotizaciones/texto-agente";
import type { ReferenciaCara } from "@/lib/cad/caras";
import { ChipCara } from "./chip-cara";

/** Una herramienta que el asistente está usando o ya usó en un turno. */
export interface ActividadChat {
  nombre: string;
  estado: "inicio" | "fin";
  ok: boolean;
  resumen: string;
}

export interface MensajeChat {
  id: string;
  rol: "usuario" | "asistente";
  contenido: string;
  actividad: ActividadChat[];
  /** Las caras del visor que la persona señaló con este mensaje. */
  referencias?: ReferenciaCara[];
  /** Lo que el modelo pensó en este turno. Solo en vivo: no se guarda. */
  razonamiento?: string;
  /** Lo último que llegó fue razonamiento: está pensando ahora mismo. */
  pensando?: boolean;
}

/** Cómo se dice cada herramienta mientras corre y cuando acabó. */
const ETIQUETAS: Record<string, { enCurso: string; hecho: string }> = {
  listar_plantillas: { enCurso: "Consultando plantillas…", hecho: "Plantillas consultadas" },
  ver_plantilla: { enCurso: "Revisando la plantilla…", hecho: "Plantilla revisada" },
  generar_diseno: { enCurso: "Generando diseño…", hecho: "Diseño generado" },
  ver_diseno_actual: { enCurso: "Revisando el diseño actual…", hecho: "Diseño revisado" },
  buscar_planchas: { enCurso: "Buscando planchas…", hecho: "Planchas consultadas" },
};

const OTRA = { enCurso: "Trabajando…", hecho: "Hecho" };

function FichaActividad({ actividad }: { actividad: ActividadChat }) {
  const etiqueta = ETIQUETAS[actividad.nombre] ?? OTRA;
  const enCurso = actividad.estado === "inicio";
  const fallo = !enCurso && !actividad.ok;

  return (
    <li
      className={cn(
        "flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        fallo ? "border-destructive/30 text-destructive" : "text-muted-foreground",
      )}
    >
      {enCurso ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin" />
      ) : fallo ? (
        <TriangleAlert className="size-3 shrink-0" />
      ) : (
        <Check className="size-3 shrink-0" />
      )}
      <span className="truncate">
        {enCurso ? etiqueta.enCurso : fallo ? actividad.resumen || "No se pudo" : etiqueta.hecho}
        {!enCurso && !fallo && actividad.resumen && (
          <span className="text-muted-foreground/70"> · {actividad.resumen}</span>
        )}
      </span>
    </li>
  );
}

/**
 * El razonamiento del modelo. Abierto mientras piensa —se lee según llega— y
 * se pliega solo cuando empieza a contestar; se puede volver a abrir.
 */
function Razonamiento({ texto, pensando }: { texto: string; pensando: boolean }) {
  // `null`: la persona no lo ha tocado y manda el estado del turno.
  const [abiertoAMano, setAbiertoAMano] = useState<boolean | null>(null);
  const abierto = abiertoAMano ?? pensando;
  const cajaRef = useRef<HTMLDivElement>(null);

  // Dentro de la caja también se sigue lo último que escribió.
  useEffect(() => {
    const caja = cajaRef.current;
    if (caja && pensando) caja.scrollTop = caja.scrollHeight;
  }, [texto, pensando]);

  return (
    <div className="text-muted-foreground min-w-0 text-xs">
      <button
        type="button"
        onClick={() => setAbiertoAMano(!abierto)}
        aria-expanded={abierto}
        className="hover:text-foreground flex items-center gap-1.5 transition-colors"
      >
        <Brain className={cn("size-3.5 shrink-0", pensando && "animate-pulse")} />
        <span>{pensando ? "Pensando…" : "Pensamiento"}</span>
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", abierto && "rotate-90")} />
      </button>
      {abierto && (
        <div
          ref={cajaRef}
          className="border-border mt-1.5 max-h-60 overflow-y-auto border-l-2 pl-3 leading-relaxed break-words whitespace-pre-wrap italic"
        >
          {texto}
        </div>
      )}
    </div>
  );
}

export function ChatMensajes({
  mensajes,
  enviando,
  error,
  onReintentar,
}: {
  mensajes: MensajeChat[];
  /** El último mensaje del asistente se está escribiendo ahora. */
  enviando: boolean;
  error: string | null;
  /** Si el turno que falló se puede volver a mandar. */
  onReintentar: (() => void) | null;
}) {
  const finRef = useRef<HTMLDivElement>(null);
  const ultimo = mensajes[mensajes.length - 1];

  // Sigue el texto según llega: el largo del último mensaje cambia con cada trozo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [
    mensajes.length,
    ultimo?.contenido.length,
    ultimo?.razonamiento?.length,
    ultimo?.actividad.length,
    enviando,
    error,
  ]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {mensajes.map((m, i) => {
          const escribiendo = enviando && i === mensajes.length - 1 && m.rol === "asistente";
          const ocupado = m.actividad.some((a) => a.estado === "inicio");

          if (m.rol === "usuario") {
            return (
              <div key={m.id} className="flex max-w-[85%] min-w-0 flex-col items-end gap-1.5 self-end">
                {m.referencias && m.referencias.length > 0 && (
                  <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Caras señaladas">
                    {m.referencias.map((r) => (
                      <li key={r.clave} className="max-w-full">
                        <ChipCara cara={r} className="text-muted-foreground" />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="bg-primary text-primary-foreground max-w-full min-w-0 rounded-xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap">
                  {m.contenido}
                </div>
              </div>
            );
          }

          return (
            <div key={m.id} className="flex max-w-[85%] min-w-0 flex-col gap-1.5 self-start">
              {m.razonamiento && (
                <Razonamiento texto={m.razonamiento} pensando={escribiendo && !!m.pensando} />
              )}
              {m.actividad.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {m.actividad.map((a, j) => (
                    <FichaActividad key={j} actividad={a} />
                  ))}
                </ul>
              )}
              {/* Solo el asistente escribe Markdown; lo de la persona va tal cual. */}
              {m.contenido && (
                <div className="bg-muted min-w-0 rounded-xl px-3.5 py-2 text-sm">
                  <TextoAgente texto={m.contenido} />
                </div>
              )}
              {escribiendo && !m.contenido && !ocupado && !m.razonamiento && (
                <div className="bg-muted text-muted-foreground self-start rounded-xl px-3.5 py-2 text-sm">
                  Pensando…
                </div>
              )}
            </div>
          );
        })}

        {error && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm"
          >
            <span>{error}</span>
            {onReintentar && (
              <button
                type="button"
                onClick={onReintentar}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        <div ref={finRef} />
      </div>
    </div>
  );
}
