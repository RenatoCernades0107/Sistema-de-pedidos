"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import * as acciones from "./acciones";
import type { ChatResumen, Mensaje } from "./acciones";

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
  creandoCotizacion: boolean;
  seleccionar: (chatId: string | null) => void;
  enviar: (texto: string) => void;
  reintentar: () => void;
  borrar: (chatId: string) => void;
  crearCotizacionOdoo: () => void;
}

const Ctx = createContext<ChatStore | null>(null);

interface ChatCache {
  mensajes: Mensaje[];
  pendingQuotation: Record<string, unknown> | null;
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
  const [cache, setCache] = useState<Record<string, ChatCache>>({});
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [enviando, iniciarEnvio] = useTransition();
  const [creandoCotizacion, setCreandoCotizacion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimoTexto, setUltimoTexto] = useState<string | null>(null);

  const seleccionar = useCallback(
    (chatId: string | null) => {
      setError(null);
      setActiveChatId(chatId);

      if (chatId === null) {
        setMensajes([]);
        setPendingQuotation(null);
        return;
      }

      const enCache = cache[chatId];
      if (enCache) {
        setMensajes(enCache.mensajes);
        setPendingQuotation(enCache.pendingQuotation);
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
          return;
        }
        setMensajes(r.data.messages);
        setPendingQuotation(r.data.newQuotation);
        setCache((prev) => ({
          ...prev,
          [chatId]: { mensajes: r.data.messages, pendingQuotation: r.data.newQuotation },
        }));
      })();
    },
    [cache],
  );

  const enviarTexto = useCallback(
    (texto: string, chatIdDestino: string | null) => {
      setError(null);
      setUltimoTexto(texto);
      // El bosquejo pendiente se refiere a la conversación tal como estaba;
      // un mensaje nuevo la deja obsoleta, así que se limpia de inmediato.
      setPendingQuotation(null);
      const mensajeUsuario: Mensaje = { role: "user", text: texto };
      setMensajes((prev) => [...prev, mensajeUsuario]);

      iniciarEnvio(async () => {
        const r = await acciones.enviarMensaje(chatIdDestino, texto);

        if (!r.ok) {
          setError(r.error);
          return;
        }

        const { chatId, reply, lastQuotation, newQuotation } = r.data;
        // Si ya se creó la cotización, no puede quedar un bosquejo pendiente.
        const pendienteFinal = lastQuotation ? null : newQuotation;
        setMensajes((prev) => {
          const conRespuesta = [...prev, { role: "assistant" as const, text: reply }];
          setCache((prevCache) => ({
            ...prevCache,
            [chatId]: { mensajes: conRespuesta, pendingQuotation: pendienteFinal },
          }));
          return conRespuesta;
        });
        setActiveChatId(chatId);
        setPendingQuotation(pendienteFinal);

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
    (texto: string) => enviarTexto(texto, activeChatId),
    [activeChatId, enviarTexto],
  );

  const reintentar = useCallback(() => {
    if (ultimoTexto) enviarTexto(ultimoTexto, activeChatId);
  }, [activeChatId, enviarTexto, ultimoTexto]);

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

      setPendingQuotation(null);
      setCache((prev) => {
        const actual = prev[chatId];
        if (!actual) return prev;
        return { ...prev, [chatId]: { ...actual, pendingQuotation: null } };
      });

      toast.success(`Cotización ${r.data.orderName} creada`, {
        description: `Total S/ ${r.data.totalPen.toFixed(2)}`,
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
