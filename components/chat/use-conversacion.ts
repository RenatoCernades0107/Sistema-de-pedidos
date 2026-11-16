"use client";

/**
 * Una conversación viva: sus mensajes, quién participa, quién vio qué, y enviar.
 *
 * Los mensajes llegan al momento por Supabase Realtime (inserts de `mensajes`,
 * `mensaje_adjuntos` y `mensaje_lecturas` de esta conversación). Si el canal no
 * conecta (la red corta los websockets), se vuelve a leer cada tanto mientras la
 * pestaña está a la vista, y siempre al volver a ella: el chat llega tarde, pero
 * llega. Lo mismo que hacía el chat del pedido, ahora para cualquier sala.
 *
 * Los adjuntos se escriben en la misma transacción que el mensaje, justo después.
 * Realtime puede entregar el mensaje antes que sus archivos, así que al llegar un
 * mensaje se piden sus adjuntos, y los inserts de adjuntos que llegan antes que
 * su mensaje se guardan hasta que aparezca.
 *
 * Enviar es optimista: el mensaje sale en pantalla con un reloj mientras suben
 * los archivos (con su avance) y corre `enviar_mensaje`. Si algo falla, lo subido
 * se borra —un archivo sin mensaje no lo encontraría nadie— y el borrador vuelve.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clienteNavegador } from "@/lib/supabase-cliente";
import type { Json } from "@/lib/supabase-tipos";
import {
  aAdjunto,
  aLectura,
  aMensaje,
  COLUMNAS_MENSAJE,
  type Adjunto,
  type FilaAdjunto,
  type FilaMensaje,
  type Lectura,
  type Mensaje,
  type Participante,
  type Referencia,
} from "@/lib/chat/tipos";
import {
  leerAdjuntos,
  leerChatInicial,
  leerDesde,
  leerLecturas,
  leerMensajes,
  leerParticipantes,
  type ChatInicial,
} from "@/lib/chat/consultas";
import { noLeidos, ordenarMensajes, rutaArchivoChat, unirLecturas, unirMensajes } from "@/lib/chat/logica";
import { borrarSubidos, medirArchivo, subirArchivo, type AdjuntoSubido } from "./subir";
import { recargarResumen } from "./use-resumen";

/** Cada cuánto se relee si Realtime no conecta. */
const RELECTURA_MS = 15_000;
/** Espera antes de marcar como leído: una ráfaga de mensajes es una sola llamada. */
const RETRASO_LEIDO_MS = 800;
/** Archivos que suben a la vez. Más satura la subida de un celular y nada llega antes. */
const SUBIDAS_A_LA_VEZ = 3;

/** Un archivo elegido en el compositor, todavía en el navegador. */
export interface ArchivoBorrador {
  id: string;
  archivo: File;
  /** El tipo con el que se sube (el navegador a veces no lo sabe: HEIC). */
  mime: string;
  /** `URL.createObjectURL` de la foto o el video; la libera quien lo tenga en ese momento. */
  vistaPrevia: string | null;
}

export interface Borrador {
  texto: string;
  referencias: Referencia[];
  archivos: ArchivoBorrador[];
}

export type EstadoArchivo = "esperando" | "subiendo" | "listo" | "error";

export interface EnvioLocal {
  estado: "enviando" | "error";
  error?: string;
  borrador: Borrador;
  archivos: { id: string; avance: number; estado: EstadoArchivo }[];
}

/** Un mensaje en pantalla. Los que todavía no llegaron a la base llevan `local`. */
export interface MensajeVista extends Mensaje {
  local?: EnvioLocal;
}

const visibilidad = {
  suscribir: (aviso: () => void) => {
    document.addEventListener("visibilitychange", aviso);
    return () => document.removeEventListener("visibilitychange", aviso);
  },
  leer: () => document.visibilityState === "visible",
  servidor: () => false,
};

const esLocal = (m: MensajeVista) => m.local !== undefined;

function liberarVistas(b: Borrador) {
  for (const a of b.archivos) if (a.vistaPrevia) URL.revokeObjectURL(a.vistaPrevia);
}

function conAdjunto(m: MensajeVista, a: Adjunto): MensajeVista {
  if (m.id !== a.mensajeId || m.adjuntos.some((x) => x.id === a.id)) return m;
  return { ...m, adjuntos: [...m.adjuntos, a].sort((x, y) => x.posicion - y.posicion) };
}

/** Une los de la base con los que siguen enviándose, que siempre van al final. */
function unirVista(previos: MensajeVista[], nuevos: Mensaje[]): MensajeVista[] {
  const reales = previos.filter((m) => !esLocal(m));
  const unidos = unirMensajes(reales, nuevos);
  if (unidos === reales) return previos;
  return [...unidos, ...previos.filter(esLocal)];
}

export interface OpcionesConversacion {
  conversacionId: string;
  usuarioId: string;
  /** Lo que ya leyó el servidor con la página. Sin esto se lee al montar. */
  inicial?: ChatInicial | null;
  /** La conversación está en pantalla: solo entonces lo que llega se marca como visto. */
  activa?: boolean;
}

export function useConversacion({ conversacionId, usuarioId, inicial = null, activa = true }: OpcionesConversacion) {
  const [mensajes, setMensajes] = useState<MensajeVista[]>(() => ordenarMensajes(inicial?.mensajes ?? []));
  const [lecturas, setLecturas] = useState<Lectura[]>(() => inicial?.lecturas ?? []);
  const [participantes, setParticipantes] = useState<Participante[]>(() => inicial?.participantes ?? []);
  const [hayAnteriores, setHayAnteriores] = useState(inicial?.hayAnteriores ?? false);
  const [cargando, setCargando] = useState(!inicial);
  const [error, setError] = useState<string | null>(null);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [enVivo, setEnVivo] = useState(false);
  const visible = useSyncExternalStore(visibilidad.suscribir, visibilidad.leer, visibilidad.servidor);

  // Las funciones de releer leen el estado vigente sin volver a crearse en cada mensaje.
  const mensajesRef = useRef(mensajes);
  useEffect(() => {
    mensajesRef.current = mensajes;
  }, [mensajes]);

  /* Adjuntos que llegaron por Realtime antes que su mensaje. */
  const adjuntosEnEspera = useRef(new Map<string, Adjunto[]>());

  const agregarAdjuntos = useCallback((nuevos: Adjunto[]) => {
    if (nuevos.length === 0) return;
    setMensajes((previos) => {
      let lista = previos;
      for (const a of nuevos) {
        if (!lista.some((m) => m.id === a.mensajeId)) {
          const espera = adjuntosEnEspera.current.get(a.mensajeId) ?? [];
          if (!espera.some((x) => x.id === a.id)) adjuntosEnEspera.current.set(a.mensajeId, [...espera, a]);
          continue;
        }
        lista = lista.map((m) => conAdjunto(m, a));
      }
      return lista;
    });
  }, []);

  const recibirMensajes = useCallback((nuevos: Mensaje[]) => {
    if (nuevos.length === 0) return;
    const conEspera = nuevos.map((m) => {
      const espera = adjuntosEnEspera.current.get(m.id);
      if (!espera) return m;
      adjuntosEnEspera.current.delete(m.id);
      return espera.reduce<Mensaje>((acc, a) => conAdjunto(acc, a), m);
    });
    setMensajes((previos) => unirVista(previos, conEspera));
  }, []);

  // Primera lectura, si el servidor no la mandó.
  useEffect(() => {
    if (inicial) return;
    let vivo = true;
    leerChatInicial(clienteNavegador(), conversacionId)
      .then((d) => {
        if (!vivo) return;
        recibirMensajes(d.mensajes);
        setLecturas((previas) => unirLecturas(previas, d.lecturas));
        setParticipantes(d.participantes);
        setHayAnteriores(d.hayAnteriores);
        setError(null);
      })
      .catch(() => {
        if (vivo) setError("No se pudo abrir la conversación.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [conversacionId, inicial, recibirMensajes]);

  // El canal en vivo.
  useEffect(() => {
    const supabase = clienteNavegador();
    const filtro = `conversacion_id=eq.${conversacionId}`;
    const canal = supabase
      .channel(`chat-${conversacionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: filtro }, (cambio) => {
        const m = aMensaje(cambio.new as FilaMensaje);
        recibirMensajes([m]);
        // Sus archivos ya están escritos (misma transacción): se piden por si
        // Realtime los entrega tarde o no los entrega.
        void leerAdjuntos(supabase, [m.id])
          .then((porMensaje) => agregarAdjuntos(porMensaje.get(m.id) ?? []))
          .catch(() => {});
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensaje_adjuntos", filter: filtro },
        (cambio) => agregarAdjuntos([aAdjunto(cambio.new as FilaAdjunto)]),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensaje_lecturas", filter: filtro },
        (cambio) =>
          setLecturas((previas) =>
            unirLecturas(previas, [aLectura(cambio.new as { mensaje_id: string; usuario_id: string; leido_en: string })]),
          ),
      )
      .subscribe((estado) => setEnVivo(estado === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [conversacionId, recibirMensajes, agregarAdjuntos]);

  /** Se pone al día: lo nuevo desde el último mensaje, quién vio qué y quién está. */
  const releer = useCallback(async () => {
    const supabase = clienteNavegador();
    const reales = mensajesRef.current.filter((m) => !esLocal(m));
    const ultimo = reales.at(-1);
    try {
      const nuevos = ultimo
        ? await leerDesde(supabase, conversacionId, ultimo.creadoEn)
        : (await leerMensajes(supabase, conversacionId)).mensajes;
      recibirMensajes(nuevos);
      // Los que ya estaban pueden haber llegado sin archivos.
      agregarAdjuntos(nuevos.flatMap((m) => m.adjuntos));
      const ids = [...new Set([...reales, ...nuevos].map((m) => m.id))];
      const [l, p] = await Promise.all([
        leerLecturas(supabase, ids),
        leerParticipantes(supabase, conversacionId),
      ]);
      setLecturas((previas) => unirLecturas(previas, l));
      setParticipantes(p);
    } catch {
      // Sin red: lo intenta la próxima vuelta.
    }
  }, [conversacionId, recibirMensajes, agregarAdjuntos]);

  // El respaldo: sin canal en vivo, releer mientras la pestaña se ve.
  useEffect(() => {
    if (enVivo) return;
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void releer();
    }, RELECTURA_MS);
    return () => clearInterval(intervalo);
  }, [enVivo, releer]);

  // Al volver a la pestaña puede haber mensajes que el canal no entregó.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") void releer();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [releer]);

  const cargarAnteriores = useCallback(async () => {
    const primero = mensajesRef.current.find((m) => !esLocal(m));
    if (!primero) return;
    setCargandoAnteriores(true);
    try {
      const supabase = clienteNavegador();
      const pagina = await leerMensajes(supabase, conversacionId, primero.creadoEn);
      recibirMensajes(pagina.mensajes);
      setHayAnteriores(pagina.hayAnteriores);
      const l = await leerLecturas(
        supabase,
        pagina.mensajes.map((m) => m.id),
      );
      setLecturas((previas) => unirLecturas(previas, l));
    } catch {
      setError("No se pudieron traer los mensajes anteriores.");
    } finally {
      setCargandoAnteriores(false);
    }
  }, [conversacionId, recibirMensajes]);

  const recargarParticipantes = useCallback(async () => {
    try {
      setParticipantes(await leerParticipantes(clienteNavegador(), conversacionId));
    } catch {
      // Se queda con la lista que tenía.
    }
  }, [conversacionId]);

  // ── Vistos ──

  const yo = participantes.find((p) => p.usuarioId === usuarioId);
  const reales = useMemo(() => mensajes.filter((m) => !esLocal(m)), [mensajes]);
  const sinLeer = useMemo(
    () => noLeidos(reales, lecturas, usuarioId, yo?.desde ?? null),
    [reales, lecturas, usuarioId, yo?.desde],
  );

  useEffect(() => {
    if (!activa || !visible || sinLeer === 0) return;
    const ajenos = reales.filter((m) => m.autorId !== usuarioId);
    const ultimo = ajenos.at(-1);
    if (!ultimo) return;
    const t = setTimeout(async () => {
      const { error: e } = await clienteNavegador().rpc("marcar_leidos", {
        p_conversacion_id: conversacionId,
        p_hasta: ultimo.creadoEn,
      });
      if (e) return;
      // Sin esperar a Realtime: si el canal no está, el contador no debe quedarse.
      const ahora = new Date().toISOString();
      setLecturas((previas) =>
        unirLecturas(
          previas,
          ajenos.map((m) => ({ mensajeId: m.id, usuarioId, leidoEn: ahora })),
        ),
      );
      void recargarResumen();
    }, RETRASO_LEIDO_MS);
    return () => clearTimeout(t);
  }, [activa, visible, sinLeer, reales, usuarioId, conversacionId]);

  // ── Enviar ──

  const actualizarLocal = useCallback((id: string, cambio: (l: EnvioLocal) => EnvioLocal) => {
    setMensajes((previos) => previos.map((m) => (m.id === id && m.local ? { ...m, local: cambio(m.local) } : m)));
  }, []);

  const enviarLocal = useCallback(
    async (localId: string, borrador: Borrador): Promise<boolean> => {
      const supabase = clienteNavegador();
      const subidas: string[] = [];
      const avance = (archivoId: string, cambio: Partial<{ avance: number; estado: EstadoArchivo }>) =>
        actualizarLocal(localId, (l) => ({
          ...l,
          archivos: l.archivos.map((a) => (a.id === archivoId ? { ...a, ...cambio } : a)),
        }));

      try {
        // Se suben en tandas, pero cada uno conserva su lugar en el mensaje.
        const adjuntos: AdjuntoSubido[] = new Array(borrador.archivos.length);
        const cola = borrador.archivos.map((a, i) => ({ a, i }));
        const trabajar = async () => {
          for (let tarea = cola.shift(); tarea; tarea = cola.shift()) {
            const { a, i } = tarea;
            const ruta = rutaArchivoChat(conversacionId, crypto.randomUUID(), a.archivo.name);
            // El bucket mira el tipo del archivo: si el navegador no lo sabía, se le pone.
            const cuerpo = a.archivo.type === a.mime ? a.archivo : a.archivo.slice(0, a.archivo.size, a.mime);
            avance(a.id, { estado: "subiendo" });
            const medidas = await medirArchivo(cuerpo, a.mime);
            try {
              await subirArchivo(ruta, cuerpo, (f) => avance(a.id, { avance: f }));
            } catch (e) {
              avance(a.id, { estado: "error" });
              throw new Error(`“${a.archivo.name}”: ${e instanceof Error ? e.message : "no se pudo subir."}`);
            }
            subidas.push(ruta);
            avance(a.id, { estado: "listo", avance: 1 });
            adjuntos[i] = { ruta, nombre: a.archivo.name, mime: a.mime, tamano: a.archivo.size, ...medidas };
          }
        };
        await Promise.all(Array.from({ length: Math.min(SUBIDAS_A_LA_VEZ, cola.length) }, trabajar));

        const { data: id, error: e } = await supabase.rpc("enviar_mensaje", {
          p_conversacion_id: conversacionId,
          p_texto: borrador.texto,
          p_referencias: borrador.referencias,
          p_adjuntos: adjuntos as unknown as Json,
        });
        if (e || !id) throw new Error(e?.message ?? "No se envió el mensaje.");

        // El mensaje como quedó en la base (con su hora y sus archivos) en lugar del local.
        let real: Mensaje | null = null;
        try {
          const { data: fila } = await supabase.from("mensajes").select(COLUMNAS_MENSAJE).eq("id", id).maybeSingle();
          if (fila) real = aMensaje(fila as FilaMensaje, (await leerAdjuntos(supabase, [id])).get(id));
        } catch {
          // Lo trae Realtime o la próxima relectura.
        }
        setMensajes((previos) => {
          const sinLocal = previos.filter((m) => m.id !== localId);
          return real ? unirVista(sinLocal, [real]) : sinLocal;
        });
        liberarVistas(borrador);
        if (!real) void releer();
        void recargarResumen();
        return true;
      } catch (e) {
        // Lo que alcanzó a subir no tiene mensaje: se borra.
        void borrarSubidos(subidas);
        actualizarLocal(localId, (l) => ({
          ...l,
          estado: "error",
          error: e instanceof Error ? e.message : "No se envió el mensaje.",
        }));
        return false;
      }
    },
    [conversacionId, actualizarLocal, releer],
  );

  /**
   * Envía un borrador. Las vistas previas pasan a ser del mensaje en pantalla:
   * el compositor ya no las libera. Devuelve el id local para poder recuperarlo
   * si falla.
   */
  const enviar = useCallback(
    async (borrador: Borrador): Promise<{ ok: boolean; localId: string }> => {
      const localId = `local-${crypto.randomUUID()}`;
      const optimista: MensajeVista = {
        id: localId,
        conversacionId,
        autorId: usuarioId,
        autor: "",
        rol: null,
        texto: borrador.texto,
        referencias: borrador.referencias,
        creadoEn: new Date().toISOString(),
        adjuntos: [],
        local: {
          estado: "enviando",
          borrador,
          archivos: borrador.archivos.map((a) => ({ id: a.id, avance: 0, estado: "esperando" })),
        },
      };
      setMensajes((previos) => [...previos, optimista]);
      return { ok: await enviarLocal(localId, borrador), localId };
    },
    [conversacionId, usuarioId, enviarLocal],
  );

  const reintentar = useCallback(
    (localId: string) => {
      const m = mensajesRef.current.find((x) => x.id === localId);
      if (!m?.local) return;
      const { borrador } = m.local;
      actualizarLocal(localId, (l) => ({
        ...l,
        estado: "enviando",
        error: undefined,
        archivos: l.archivos.map((a) => ({ ...a, avance: 0, estado: "esperando" })),
      }));
      void enviarLocal(localId, borrador);
    },
    [actualizarLocal, enviarLocal],
  );

  /** Saca de la lista un mensaje que no se envió y devuelve su borrador (con sus vistas previas). */
  const recuperar = useCallback((localId: string): Borrador | null => {
    const m = mensajesRef.current.find((x) => x.id === localId);
    if (!m?.local) return null;
    setMensajes((previos) => previos.filter((x) => x.id !== localId));
    return m.local.borrador;
  }, []);

  const descartar = useCallback(
    (localId: string) => {
      const borrador = recuperar(localId);
      if (borrador) liberarVistas(borrador);
    },
    [recuperar],
  );

  // Al irse, las vistas previas de lo que quedó sin enviar ya no las usa nadie.
  useEffect(
    () => () => {
      for (const m of mensajesRef.current) if (m.local) liberarVistas(m.local.borrador);
    },
    [],
  );

  return {
    conversacionId,
    usuarioId,
    mensajes,
    lecturas,
    participantes,
    hayAnteriores,
    cargando,
    cargandoAnteriores,
    error,
    enVivo,
    sinLeer,
    cargarAnteriores,
    recargarParticipantes,
    enviar,
    reintentar,
    recuperar,
    descartar,
  };
}

export type Conversacion = ReturnType<typeof useConversacion>;
