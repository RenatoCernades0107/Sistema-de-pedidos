/**
 * La lógica pura del chat que no es contrato con la base: agrupar la lista,
 * juzgar y nombrar archivos, unir mensajes que llegan por dos caminos y contar
 * lo no leído. Aparte de los componentes para poder probarla sin navegador.
 */

import { nombreSeguro } from "@/lib/adjuntos";
import {
  MAX_BYTES_ADJUNTO,
  MIME_CHAT,
  destinatariosDe,
  type Lectura,
  type Mensaje,
  type Participante,
  type ResumenConversacion,
  type TipoConversacion,
} from "./tipos";

// ── La lista de conversaciones ───────────────────────────────────────────────

export interface GrupoConversaciones {
  tipo: TipoConversacion;
  titulo: string;
  conversaciones: ResumenConversacion[];
}

const TITULOS_GRUPO: Record<TipoConversacion, string> = {
  general: "General",
  canal: "Canales",
  directo: "Mensajes directos",
  pedido: "Pedidos",
};

const ORDEN_GRUPOS: TipoConversacion[] = ["general", "canal", "directo", "pedido"];

/** Lo más reciente primero; lo que nunca tuvo mensajes, al fondo y por nombre. */
const porActividad = (a: ResumenConversacion, b: ResumenConversacion) => {
  if (a.ultimoMensajeEn && b.ultimoMensajeEn) return Date.parse(b.ultimoMensajeEn) - Date.parse(a.ultimoMensajeEn);
  if (a.ultimoMensajeEn) return -1;
  if (b.ultimoMensajeEn) return 1;
  return a.nombre.localeCompare(b.nombre, "es");
};

/** General arriba, luego canales, directos y pedidos. Los grupos vacíos no salen. */
export function agruparConversaciones(lista: ResumenConversacion[], filtro = ""): GrupoConversaciones[] {
  const buscado = normalizar(filtro);
  const visibles = buscado ? lista.filter((c) => normalizar(c.nombre).includes(buscado)) : lista;
  return ORDEN_GRUPOS.map((tipo) => ({
    tipo,
    titulo: TITULOS_GRUPO[tipo],
    conversaciones: visibles.filter((c) => c.tipo === tipo).sort(porActividad),
  })).filter((g) => g.conversaciones.length > 0);
}

/** Para buscar sin que importen tildes ni mayúsculas: "Logística" ≈ "logistica". */
export const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** La línea de la lista: "Tú: ya está", "Carla: 📎 2 archivos". */
export function vistaPrevia(c: ResumenConversacion, usuarioId: string): string {
  if (!c.ultimoMensajeEn) return c.descripcion ?? "Sin mensajes todavía";
  const texto = c.ultimoTexto?.trim()
    ? c.ultimoTexto.trim().replace(/\s+/g, " ")
    : c.ultimoAdjuntos > 0
      ? c.ultimoAdjuntos === 1
        ? "📎 Un archivo"
        : `📎 ${c.ultimoAdjuntos} archivos`
      : "";
  if (c.ultimoAutorId === usuarioId) return `Tú: ${texto}`;
  // En un directo ya se sabe quién habla: es la otra persona.
  if (c.tipo === "directo" || !c.ultimoAutor) return texto;
  return `${c.ultimoAutor.split(" ")[0]}: ${texto}`;
}

/**
 * La hora de la lista: "14:05" si fue hoy, "ayer", o "12/11". `hoyLima` y el
 * momento vienen ya en hora de Lima (`momentoEnLima`).
 */
export function horaCorta(momento: string, hoyLima: string): string {
  if (!momento) return "";
  const dia = momento.slice(0, 10);
  if (dia === hoyLima) return momento.slice(11, 16);
  const ayer = new Date(`${hoyLima}T12:00:00Z`);
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  if (dia === ayer.toISOString().slice(0, 10)) return "ayer";
  const [a, m, d] = dia.split("-");
  return a === hoyLima.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a.slice(2)}`;
}

// ── Archivos ─────────────────────────────────────────────────────────────────

/**
 * El tipo por la extensión, para cuando el navegador no lo sabe: Windows y
 * algunos Android entregan las fotos HEIC del iPhone con `type` vacío.
 */
const MIME_POR_EXTENSION: Record<string, (typeof MIME_CHAT)[number]> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
};

/** El tipo con el que se sube, o `null` si el chat no lo acepta. */
export function mimeDeArchivo(archivo: { name: string; type: string }): string | null {
  if ((MIME_CHAT as readonly string[]).includes(archivo.type)) return archivo.type;
  const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "";
  // Solo se adivina si el navegador no dijo nada o dijo algo genérico; un tipo
  // concreto que no está en la lista (un .docx) se rechaza tal cual.
  if (archivo.type && archivo.type !== "application/octet-stream") return null;
  return MIME_POR_EXTENSION[extension] ?? null;
}

/** El motivo del rechazo, o `null` si el archivo puede ir al chat. */
export function validarArchivoChat(archivo: { name: string; type: string; size: number }): string | null {
  if (archivo.size === 0) return `“${archivo.name}” está vacío.`;
  if (!mimeDeArchivo(archivo)) {
    return `“${archivo.name}” no se puede enviar: solo fotos, videos o PDF.`;
  }
  if (archivo.size > MAX_BYTES_ADJUNTO) {
    return `“${archivo.name}” pesa ${pesoTexto(archivo.size)}; el máximo es 50 MB.`;
  }
  return null;
}

/**
 * Dónde va el archivo en el bucket: `conversaciones/<conv>/<uuid>-<nombre>`. La
 * carpeta es lo que mira la RLS; el uuid evita que dos fotos `image.jpg` se pisen.
 */
export const rutaArchivoChat = (conversacionId: string, uuid: string, nombre: string) =>
  `conversaciones/${conversacionId}/${uuid}-${nombreSeguro(nombre)}`;

/** 860160 → "840 KB". */
export function pesoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** 75.4 → "1:15". */
export function duracionTexto(segundos: number | null): string {
  if (segundos == null || !Number.isFinite(segundos)) return "";
  const s = Math.round(segundos);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ── Mensajes ─────────────────────────────────────────────────────────────────

/** Por fecha y, si empatan, por id: el orden no puede cambiar entre lecturas. */
export const ordenarMensajes = <M extends Pick<Mensaje, "id" | "creadoEn">>(lista: M[]) =>
  [...lista].sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn) || a.id.localeCompare(b.id));

/**
 * Une sin repetir: el mismo mensaje llega por Realtime, por la relectura y por
 * la respuesta del envío. Si el que llega trae adjuntos y el de antes no (llegó
 * por Realtime antes que sus archivos), se queda con los adjuntos.
 */
export function unirMensajes<M extends Mensaje>(previos: M[], nuevos: M[]): M[] {
  if (nuevos.length === 0) return previos;
  const porId = new Map(previos.map((m) => [m.id, m]));
  let cambio = false;
  for (const n of nuevos) {
    const antes = porId.get(n.id);
    if (!antes) {
      porId.set(n.id, n);
      cambio = true;
    } else if (n.adjuntos.length > antes.adjuntos.length) {
      porId.set(n.id, { ...antes, adjuntos: n.adjuntos });
      cambio = true;
    }
  }
  return cambio ? ordenarMensajes([...porId.values()]) : previos;
}

/** Une lecturas sin repetir la misma persona en el mismo mensaje. */
export function unirLecturas(previas: Lectura[], nuevas: Lectura[]): Lectura[] {
  const clave = (l: Lectura) => `${l.mensajeId}:${l.usuarioId}`;
  const vistas = new Set(previas.map(clave));
  const faltan = nuevas.filter((l) => {
    const k = clave(l);
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  return faltan.length ? [...previas, ...faltan] : previas;
}

/**
 * Los mensajes ajenos que la persona no vio. Solo cuentan los que eran para
 * ella: los de antes de que entrara al canal no.
 */
export function noLeidos(
  mensajes: Pick<Mensaje, "id" | "autorId" | "creadoEn">[],
  lecturas: Lectura[],
  usuarioId: string,
  desde: string | null,
): number {
  const vistos = new Set(lecturas.filter((l) => l.usuarioId === usuarioId).map((l) => l.mensajeId));
  const inicio = desde ? Date.parse(desde) : -Infinity;
  return mensajes.filter((m) => m.autorId !== usuarioId && !vistos.has(m.id) && Date.parse(m.creadoEn) >= inicio)
    .length;
}

export interface InfoLectura {
  participante: Participante;
  leidoEn: string | null;
}

/** "Visto por" (con su hora, el primero que lo vio arriba) y "Falta ver". */
export function infoDeLecturas(
  m: Pick<Mensaje, "id" | "autorId" | "creadoEn">,
  participantes: Participante[],
  lecturas: Lectura[],
): { vistoPor: InfoLectura[]; faltan: Participante[] } {
  const delMensaje = new Map(lecturas.filter((l) => l.mensajeId === m.id).map((l) => [l.usuarioId, l.leidoEn]));
  const para = destinatariosDe(m, participantes);
  const vistoPor = para
    .filter((p) => delMensaje.has(p.usuarioId))
    .map((p) => ({ participante: p, leidoEn: delMensaje.get(p.usuarioId) ?? null }))
    .sort((a, b) => Date.parse(a.leidoEn ?? "") - Date.parse(b.leidoEn ?? ""));
  const faltan = para.filter((p) => !delMensaje.has(p.usuarioId));
  return { vistoPor, faltan };
}
