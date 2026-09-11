"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import * as acciones from "./acciones";
import type { ChatResumen, Cotizacion, Mensaje, TurnoEnviado } from "./acciones";

/** Lo que se puede descargar de un chat que ya creó su cotización en Odoo. */
export interface Documentos {
  cotizacion: Cotizacion;
  /** La hoja de corte existe solo si se cotizó corte a medida. */
  hojaDeCorte: boolean;
}

interface ChatStore {
  chats: ChatResumen[];
  activeChatId: string | null;
  mensajes: Mensaje[];
  cargandoMensajes: boolean;
  enviando: boolean;
  error: string | null;
  /**
   * Bosquejo pendiente de confirmar para el chat activo (`new_quotation`).
   * Refleja solo el último turno: se limpia al mandar un mensaje nuevo o en
   * cuanto la cotización efectivamente se crea (`lastQuotation` aparece).
   */
  pendingQuotation: Record<string, unknown> | null;
  /**
   * Los PDFs del chat activo, o `null` si todavía no creó su cotización. A
   * diferencia de `pendingQuotation` esto no se limpia al seguir conversando:
   * la cotización ya existe en Odoo y se puede volver a descargar siempre,
   * también al reabrir el chat días después.
   */
  documentos: Documentos | null;
  creandoCotizacion: boolean;
  seleccionar: (chatId: string | null) => void;
  /** Texto, archivos, o las dos cosas: lo único que se rechaza es un mensaje sin nada. */
  enviar: (texto: string, archivos?: File[]) => void;
  reintentar: () => void;
  borrar: (chatId: string) => void;
  crearCotizacionOdoo: () => void;
}

const Ctx = createContext<ChatStore | null>(null);

/**
 * Sin cotización creada no hay nada que descargar: los dos PDFs se llaman por
 * el número de orden, y la hoja de corte además necesita que se haya cotizado
 * corte (`hasCutSheet`, que la API calcula por nosotros).
 */
function documentosDe(cotizacion: Cotizacion | null, hojaDeCorte: boolean): Documentos | null {
  if (!cotizacion) return null;
  return { cotizacion, hojaDeCorte };
}

/**
 * Manda el turno al servidor. Va por `fetch` a un route handler y no por una
 * Server Action porque una Server Action rechaza cuerpos de más de 1 MB, y una
 * foto de un plano pasa de eso ella sola. Los archivos viajan crudos dentro de
 * un `FormData`: pasarlos en base64 los engordaría un 33% contra el tope de
 * 4.5 MB que impone Vercel.
 */
async function enviarAlAgente(
  chatId: string | null,
  texto: string,
  archivos: File[],
): Promise<{ ok: true; data: TurnoEnviado } | { ok: false; error: string }> {
  const form = new FormData();
  if (chatId) form.append("chatId", chatId);
  form.append("mensaje", texto);
  for (const archivo of archivos) form.append("archivos", archivo);

  let res: Response;
  try {
    res = await fetch("/api/cotizaciones/mensajes", { method: "POST", body: form });
  } catch {
    return { ok: false, error: "No se pudo conectar con el agente de cotizaciones." };
  }

  if (!res.ok) {
    // El route handler explica el motivo (archivo muy pesado, tipo no admitido);
    // si ni eso llega, el estado es lo único que hay.
    const motivo = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => null);
    return { ok: false, error: motivo || "No se pudo enviar el mensaje. Intenta de nuevo." };
  }

  return { ok: true, data: (await res.json()) as TurnoEnviado };
}

interface ChatCache {
  mensajes: Mensaje[];
  pendingQuotation: Record<string, unknown> | null;
  documentos: Documentos | null;
}

/**
 * Contexto propio y pequeño, separado del `StoreProvider` global: los chats
 * no son datos de `pedidos` y cambian con cada turno de conversación, así
 * que no tiene sentido colgarlos del layout compartido. La Quote Agent API
 * es la fuente de verdad — este contexto solo cachea lo que ya se pidió.
 */
export function ChatProvider({
  children,
  chatsIniciales,
}: {
  children: React.ReactNode;
  chatsIniciales: ChatResumen[];
}) {
  const [chats, setChats] = useState(chatsIniciales);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pendingQuotation, setPendingQuotation] = useState<Record<string, unknown> | null>(null);
  const [documentos, setDocumentos] = useState<Documentos | null>(null);
  const [cache, setCache] = useState<Record<string, ChatCache>>({});
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [enviando, iniciarEnvio] = useTransition();
  const [creandoCotizacion, setCreandoCotizacion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimoTexto, setUltimoTexto] = useState<string | null>(null);
  const [ultimosArchivos, setUltimosArchivos] = useState<File[]>([]);

  const seleccionar = useCallback(
    (chatId: string | null) => {
      setError(null);
      setActiveChatId(chatId);

      if (chatId === null) {
        setMensajes([]);
        setPendingQuotation(null);
        setDocumentos(null);
        return;
      }

      const enCache = cache[chatId];
      if (enCache) {
        setMensajes(enCache.mensajes);
        setPendingQuotation(enCache.pendingQuotation);
        setDocumentos(enCache.documentos);
        return;
      }

      setCargandoMensajes(true);
      void (async () => {
        const r = await acciones.obtenerChat(chatId);
        setCargandoMensajes(false);
        if (!r.ok) {
          toast.error("No se pudo abrir el chat", { description: r.error });
          setActiveChatId(null);
          setMensajes([]);
          setPendingQuotation(null);
          setDocumentos(null);
          return;
        }
        // `lastQuotation` del detalle es persistente (no solo del último
        // turno), así que un chat viejo recupera aquí sus descargas.
        const docs = documentosDe(r.data.lastQuotation, r.data.hasCutSheet);
        setMensajes(r.data.messages);
        setPendingQuotation(r.data.newQuotation);
        setDocumentos(docs);
        setCache((prev) => ({
          ...prev,
          [chatId]: {
            mensajes: r.data.messages,
            pendingQuotation: r.data.newQuotation,
            documentos: docs,
          },
        }));
      })();
    },
    [cache],
  );

  const enviarTexto = useCallback(
    (texto: string, chatIdDestino: string | null, archivos: File[] = []) => {
      setError(null);
      setUltimoTexto(texto);
      setUltimosArchivos(archivos);
      // El bosquejo pendiente se refiere a la conversación tal como estaba;
      // un mensaje nuevo la deja obsoleta, así que se limpia de inmediato.
      setPendingQuotation(null);
      // El eco optimista lleva ya los archivos, con la ficha que se puede armar
      // sin el servidor: el id real llega con la respuesta y lo reemplaza. Sin
      // esto el adjunto desaparece de la pantalla justo al mandarlo, que es lo
      // que hace dudar de si se envió.
      const mensajeUsuario: Mensaje = {
        role: "user",
        text: texto,
        adjuntos: archivos.map((a) => ({
          attachmentId: "",
          filename: a.name,
          contentType: a.type,
          size: a.size,
        })),
      };
      setMensajes((prev) => [...prev, mensajeUsuario]);

      iniciarEnvio(async () => {
        const r = await enviarAlAgente(chatIdDestino, texto, archivos);

        if (!r.ok) {
          setError(r.error);
          return;
        }

        const { chatId, reply, lastQuotation, newQuotation, hasCutSheet } = r.data;
        // Si ya se creó la cotización, no puede quedar un bosquejo pendiente.
        const pendienteFinal = lastQuotation ? null : newQuotation;
        // `lastQuotation` solo viene en el turno que la crea; los turnos
        // siguientes no traen nada, y ahí lo que ya se podía descargar sigue
        // pudiéndose. De ahí el `?? docsPrevios` en vez de pisarlo con null.
        const docs = documentosDe(lastQuotation, hasCutSheet);
        setMensajes((prev) => {
          // El eco optimista se queda con la ficha provisional (sin id, sin
          // peso); aquí se cambia por la que devolvió el agente, que es la que
          // permite volver a abrir el archivo.
          const conAdjuntosReales = prev.map((m, i) =>
            i === prev.length - 1 && m.role === "user" ? { ...m, adjuntos: r.data.adjuntos } : m,
          );
          const conRespuesta = [
            ...conAdjuntosReales,
            { role: "assistant" as const, text: reply, adjuntos: [] },
          ];
          setCache((prevCache) => ({
            ...prevCache,
            [chatId]: {
              mensajes: conRespuesta,
              pendingQuotation: pendienteFinal,
              documentos: docs ?? prevCache[chatId]?.documentos ?? null,
            },
          }));
          return conRespuesta;
        });
        setActiveChatId(chatId);
        setPendingQuotation(pendienteFinal);
        if (docs) setDocumentos(docs);

        const listado = await acciones.listarChats();
        if (listado.ok) setChats(listado.data);

        if (lastQuotation) {
          toast.success(`Cotización ${lastQuotation.orderName} creada`, {
            description: `Total S/ ${lastQuotation.totalPen.toFixed(2)}`,
          });
        }
      });
    },
    [],
  );

  const enviar = useCallback(
    (texto: string, archivos: File[] = []) => enviarTexto(texto, activeChatId, archivos),
    [activeChatId, enviarTexto],
  );

  // Reintentar repite el turno entero, archivos incluidos: el composer ya los
  // soltó, así que si no se reenviaran, el reintento mandaría un mensaje
  // distinto del que falló.
  const reintentar = useCallback(() => {
    if (ultimoTexto !== null) enviarTexto(ultimoTexto, activeChatId, ultimosArchivos);
  }, [activeChatId, enviarTexto, ultimoTexto, ultimosArchivos]);

  const borrar = useCallback(
    (chatId: string) => {
      iniciarEnvio(async () => {
        const r = await acciones.borrarChat(chatId);
        if (!r.ok) {
          toast.error("No se pudo borrar el chat", { description: r.error });
          return;
        }
        setChats((prev) => prev.filter((c) => c.chatId !== chatId));
        setCache((prev) => {
          const resto = { ...prev };
          delete resto[chatId];
          return resto;
        });
        if (activeChatId === chatId) {
          setActiveChatId(null);
          setMensajes([]);
          setPendingQuotation(null);
          setDocumentos(null);
        }
        toast.success("Chat borrado");
      });
    },
    [activeChatId],
  );

  const crearCotizacionOdoo = useCallback(() => {
    const chatId = activeChatId;
    if (!chatId) return;

    setCreandoCotizacion(true);
    void (async () => {
      const r = await acciones.crearCotizacion(chatId);
      setCreandoCotizacion(false);

      if (!r.ok) {
        toast.error("No se pudo crear la cotización en Odoo", { description: r.error });
        return;
      }

      const { reply, lastQuotation, newQuotation, hasCutSheet } = r.data;
      const docs = documentosDe(lastQuotation, hasCutSheet);

      setPendingQuotation(newQuotation);
      setDocumentos(docs);
      setMensajes((prev) => {
        const conRespuesta = [
          ...prev,
          { role: "assistant" as const, text: reply, adjuntos: [] },
        ];
        setCache((prevCache) => ({
          ...prevCache,
          [chatId]: {
            mensajes: conRespuesta,
            pendingQuotation: newQuotation,
            documentos: docs,
          },
        }));
        return conRespuesta;
      });

      toast.success(`Cotización ${lastQuotation.orderName} creada`, {
        description: `Total S/ ${lastQuotation.totalPen.toFixed(2)}`,
      });

      const listado = await acciones.listarChats();
      if (listado.ok) setChats(listado.data);
    })();
  }, [activeChatId]);

  const value = useMemo<ChatStore>(
    () => ({
      chats,
      activeChatId,
      mensajes,
      cargandoMensajes,
      enviando,
      error,
      pendingQuotation,
      documentos,
      creandoCotizacion,
      seleccionar,
      enviar,
      reintentar,
      borrar,
      crearCotizacionOdoo,
    }),
    [
      chats,
      activeChatId,
      mensajes,
      cargandoMensajes,
      enviando,
      error,
      pendingQuotation,
      documentos,
      creandoCotizacion,
      seleccionar,
      enviar,
      reintentar,
      borrar,
      crearCotizacionOdoo,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat debe usarse dentro de ChatProvider");
  return ctx;
}
