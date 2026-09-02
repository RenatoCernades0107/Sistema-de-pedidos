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
  seleccionar: (chatId: string | null) => void;
  enviar: (texto: string) => void;
  reintentar: () => void;
  borrar: (chatId: string) => void;
}

const Ctx = createContext<ChatStore | null>(null);

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
  const [cache, setCache] = useState<Record<string, Mensaje[]>>({});
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [enviando, iniciarEnvio] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ultimoTexto, setUltimoTexto] = useState<string | null>(null);

  const seleccionar = useCallback(
    (chatId: string | null) => {
      setError(null);
      setActiveChatId(chatId);

      if (chatId === null) {
        setMensajes([]);
        return;
      }

      const enCache = cache[chatId];
      if (enCache) {
        setMensajes(enCache);
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
          return;
        }
        setMensajes(r.data.messages);
        setCache((prev) => ({ ...prev, [chatId]: r.data.messages }));
      })();
    },
    [cache],
  );

  const enviarTexto = useCallback(
    (texto: string, chatIdDestino: string | null) => {
      setError(null);
      setUltimoTexto(texto);
      const mensajeUsuario: Mensaje = { role: "user", text: texto };
      setMensajes((prev) => [...prev, mensajeUsuario]);

      iniciarEnvio(async () => {
        const r = await acciones.enviarMensaje(chatIdDestino, texto);

        if (!r.ok) {
          setError(r.error);
          return;
        }

        const { chatId, reply, lastQuotation } = r.data;
        setMensajes((prev) => {
          const conRespuesta = [...prev, { role: "assistant" as const, text: reply }];
          setCache((prevCache) => ({ ...prevCache, [chatId]: conRespuesta }));
          return conRespuesta;
        });
        setActiveChatId(chatId);

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
        }
        toast.success("Chat borrado");
      });
    },
    [activeChatId],
  );

  const value = useMemo<ChatStore>(
    () => ({
      chats,
      activeChatId,
      mensajes,
      cargandoMensajes,
      enviando,
      error,
      seleccionar,
      enviar,
      reintentar,
      borrar,
    }),
    [chats, activeChatId, mensajes, cargandoMensajes, enviando, error, seleccionar, enviar, reintentar, borrar],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat debe usarse dentro de ChatProvider");
  return ctx;
}
