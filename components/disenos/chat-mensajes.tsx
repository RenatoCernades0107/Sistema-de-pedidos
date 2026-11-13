"use client";

import { useEffect, useRef } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TextoAgente } from "@/components/cotizaciones/texto-agente";

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
  }, [mensajes.length, ultimo?.contenido.length, ultimo?.actividad.length, enviando, error]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {mensajes.map((m, i) => {
          const escribiendo = enviando && i === mensajes.length - 1 && m.rol === "asistente";
          const ocupado = m.actividad.some((a) => a.estado === "inicio");

          if (m.rol === "usuario") {
            return (
              <div
                key={m.id}
                className="bg-primary text-primary-foreground max-w-[85%] min-w-0 self-end rounded-xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap"
              >
                {m.contenido}
              </div>
            );
          }

          return (
            <div key={m.id} className="flex max-w-[85%] min-w-0 flex-col gap-1.5 self-start">
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
              {escribiendo && !m.contenido && !ocupado && (
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
