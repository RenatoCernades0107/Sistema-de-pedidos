"use client";

/**
 * La mitad izquierda de `/disenos`: la conversación con el asistente.
 *
 * El asistente contesta en streaming por `app/api/disenos/chat`. Cuando genera
 * un diseño llega un evento `diseno` y se le pasa al contexto compartido con
 * `guardar: false` —la ruta ya guardó la versión—, que es lo que mueve el visor
 * y el formulario de la derecha.
 *
 * La conversación guardada se lee al abrir, con una Server Action. Lo que se
 * ve mientras tanto es estado de aquí: el servidor guarda el turno al cerrarlo,
 * y si falla sin haber dicho nada no guarda nada, así que ese turno también se
 * quita de la pantalla y se puede reintentar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cargarMensajes } from "@/app/(app)/disenos/acciones";
import { useDiseno } from "./diseno-contexto";
import { ChatCompositor } from "./chat-compositor";
import { ChatMensajes, type MensajeChat } from "./chat-mensajes";
import { leerEventos } from "./chat-sse";

const SUGERENCIAS = [
  "Una caja de 20 × 15 × 10 cm en acrílico de 3 mm con tapa",
  "Un porta afiche A4 vertical para mostrador",
  "Un ánfora de 30 × 30 × 40 cm con ranura arriba",
  "¿Qué productos puedes diseñar?",
];

const ERROR_RED = "No se pudo hablar con el asistente. Revisa tu conexión e intenta de nuevo.";

type Fase = "cargando" | "lista" | "sin_historial";

export function PanelChat(props: { disenoId: string }) {
  const { disenoId } = props;
  const { aplicar } = useDiseno();

  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [fase, setFase] = useState<Fase>("cargando");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** El mensaje del turno que falló sin dejar nada, para "Reintentar". */
  const [pendiente, setPendiente] = useState<string | null>(null);
  /** Falta la clave del modelo: no es algo que se arregle reintentando. */
  const [sinConfigurar, setSinConfigurar] = useState<string | null>(null);

  const enCurso = useRef<AbortController | null>(null);
  // `aplicar` puede cambiar de identidad entre renders; el turno en marcha usa la vigente.
  const aplicarRef = useRef(aplicar);
  useEffect(() => {
    aplicarRef.current = aplicar;
  }, [aplicar]);

  // La conversación guardada. Si no se puede leer se sigue igual: se puede
  // escribir, solo que sin ver lo anterior.
  useEffect(() => {
    let vigente = true;
    cargarMensajes(disenoId)
      .then((guardados) => {
        if (!vigente) return;
        // Si ya se escribió algo mientras cargaba, lo guardado va delante.
        setMensajes((actuales) => [
          ...guardados.map(
            (m): MensajeChat => ({
              id: m.id,
              rol: m.rol,
              contenido: m.contenido,
              actividad: m.herramientas.map((h) => ({ ...h, estado: "fin" as const })),
            }),
          ),
          ...actuales,
        ]);
        setFase("lista");
      })
      .catch(() => {
        if (vigente) setFase("sin_historial");
      });
    return () => {
      vigente = false;
    };
  }, [disenoId]);

  // Al salir de la pantalla se corta la respuesta: el servidor guarda lo que hubiera.
  useEffect(() => () => enCurso.current?.abort(), []);

  const enviar = useCallback(
    async (mensaje: string) => {
      const limpio = mensaje.trim();
      if (!limpio || enCurso.current) return;

      const control = new AbortController();
      enCurso.current = control;
      const idUsuario = crypto.randomUUID();
      const idRespuesta = crypto.randomUUID();

      setError(null);
      setPendiente(null);
      setEnviando(true);
      setMensajes((m) => [
        ...m,
        { id: idUsuario, rol: "usuario", contenido: limpio, actividad: [] },
        { id: idRespuesta, rol: "asistente", contenido: "", actividad: [] },
      ]);

      const cambiar = (cambio: (m: MensajeChat) => MensajeChat) =>
        setMensajes((todos) => todos.map((m) => (m.id === idRespuesta ? cambio(m) : m)));

      // Si el turno dejó algo en pantalla. Lo mismo que mira el servidor para guardar.
      let produjo = false;
      let fallo: string | null = null;

      try {
        const res = await fetch("/api/disenos/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disenoId, mensaje: limpio }),
          signal: control.signal,
        });

        if (!res.ok || !res.body) {
          const cuerpo = (await res.json().catch(() => ({}))) as { error?: string; codigo?: string };
          fallo = cuerpo.error ?? "El asistente no respondió. Intenta de nuevo.";
          if (cuerpo.codigo === "llm_no_configurado") setSinConfigurar(fallo);
        } else {
          for await (const evento of leerEventos(res.body)) {
            switch (evento.tipo) {
              case "texto":
                produjo = true;
                cambiar((m) => ({ ...m, contenido: m.contenido + evento.delta }));
                break;
              case "herramienta":
                produjo = true;
                if (evento.estado === "inicio") {
                  cambiar((m) => ({
                    ...m,
                    actividad: [...m.actividad, { nombre: evento.nombre, estado: "inicio", ok: true, resumen: "" }],
                  }));
                } else {
                  // Cierra la más antigua de ese nombre que siga abierta.
                  cambiar((m) => {
                    const i = m.actividad.findIndex((a) => a.nombre === evento.nombre && a.estado === "inicio");
                    if (i === -1) return m;
                    const actividad = [...m.actividad];
                    actividad[i] = {
                      nombre: evento.nombre,
                      estado: "fin",
                      ok: evento.ok,
                      resumen: evento.resumen ?? "",
                    };
                    return { ...m, actividad };
                  });
                }
                break;
              case "diseno":
                // La ruta ya guardó la versión: aquí solo se muestra.
                void aplicarRef.current(evento.plantilla, evento.parametros, { guardar: false });
                break;
              case "error":
                fallo = evento.mensaje;
                break;
              case "fin":
                break;
            }
          }
        }
      } catch {
        // Detenido a mano no es un error; lo demás es la red.
        if (!control.signal.aborted) fallo = ERROR_RED;
      }

      const detenido = control.signal.aborted;

      if (produjo) {
        // Lo que quedó a medias se deja, con sus herramientas cerradas.
        cambiar((m) => ({
          ...m,
          actividad: m.actividad.map((a) =>
            a.estado === "inicio" ? { ...a, estado: "fin", ok: false, resumen: "Interrumpido" } : a,
          ),
        }));
      } else {
        // El servidor no guardó nada de este turno: tampoco se queda aquí.
        setMensajes((todos) => todos.filter((m) => m.id !== idUsuario && m.id !== idRespuesta));
        if (detenido) setTexto((actual) => actual || limpio);
        else if (fallo) setPendiente(limpio);
      }

      if (fallo && !detenido) setError(fallo);
      enCurso.current = null;
      setEnviando(false);
    },
    [disenoId],
  );

  const enviarTexto = () => {
    if (!texto.trim() || enviando) return;
    const mensaje = texto;
    setTexto("");
    void enviar(mensaje);
  };

  const detener = () => enCurso.current?.abort();

  const vacio = mensajes.length === 0 && !error;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Asistente de diseños">
      {sinConfigurar ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="font-medium">El asistente no está disponible</p>
          <p className="text-muted-foreground max-w-sm text-sm">{sinConfigurar}</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Mientras tanto puedes diseñar con el formulario de la derecha.
          </p>
        </div>
      ) : fase === "cargando" && vacio ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          Cargando conversación…
        </div>
      ) : vacio ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-6 text-center">
          <div className="flex flex-col items-center gap-1">
            <Sparkles className="text-muted-foreground mb-1 size-5" />
            <p className="font-medium">Asistente de diseños</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Describe el producto con sus medidas y el material. El diseño aparece a la derecha y lo
              puedes seguir ajustando aquí o en el formulario.
            </p>
            {fase === "sin_historial" && (
              <p className="text-muted-foreground max-w-sm text-xs">
                No se pudo cargar la conversación anterior de este diseño.
              </p>
            )}
          </div>
          <ul className="flex max-w-md flex-wrap justify-center gap-2">
            {SUGERENCIAS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => void enviar(s)}
                  disabled={enviando}
                  className="hover:bg-muted rounded-full border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ChatMensajes
          mensajes={mensajes}
          enviando={enviando}
          error={error}
          onReintentar={pendiente && !enviando ? () => void enviar(pendiente) : null}
        />
      )}

      <ChatCompositor
        texto={texto}
        onTexto={setTexto}
        onEnviar={enviarTexto}
        onDetener={detener}
        enviando={enviando}
        deshabilitado={sinConfigurar !== null}
      />
    </section>
  );
}
