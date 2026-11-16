/**
 * El contrato del chat del equipo (migración `20261129000100_chat.sql`).
 *
 * Un mensaje lleva su texto con fichas `@r1`, `@r2`… y, aparte, la lista de
 * referencias: una foto de cada entidad nombrada (cliente, pedido, plancha,
 * diseño 3D o persona). La foto es lo que se pinta: el mensaje se sigue leyendo
 * igual aunque el pedido o el diseño cambien después. El mismo patrón que las
 * caras del chat de diseños (`lib/cad/caras.ts`).
 *
 * Qué va en `id` según el tipo:
 *   - cliente → el id del partner de Odoo (`"1234"`), o `n:<nombre>` si el cliente
 *               solo existe como texto en los pedidos (sin Odoo o pedidos viejos).
 *   - pedido  → el código (`P2611-001`).
 *   - plancha → `g:<grupo_id>` (material + color + espesor) o `f:<formato_id>`.
 *   - diseno  → el id de `cad_disenos` (uuid).
 *   - usuario → el id de `usuarios` (uuid). La base lo usa para avisar la mención.
 */

import { z } from "zod";
import type { Rol } from "@/lib/dominio";

// ── Conversaciones ───────────────────────────────────────────────────────────

export type TipoConversacion = "general" | "canal" | "directo" | "pedido";

export interface ResumenConversacion {
  id: string;
  tipo: TipoConversacion;
  /** Para un directo, el nombre de la otra persona; para un pedido, "Pedido P2611-001". */
  nombre: string;
  descripcion: string | null;
  pedidoId: string | null;
  pedidoCodigo: string | null;
  otroUsuarioId: string | null;
  otroUsuarioRol: Rol | null;
  miembros: number;
  ultimoMensajeEn: string | null;
  /** El último texto con las fichas ya cambiadas por `@etiqueta`. */
  ultimoTexto: string | null;
  ultimoAutor: string | null;
  ultimoAutorId: string | null;
  ultimoAdjuntos: number;
  sinLeer: number;
  mencionesSinLeer: number;
}

/** Fila de `resumen_conversaciones()`. */
export interface FilaResumen {
  id: string;
  tipo: TipoConversacion;
  nombre: string | null;
  descripcion: string | null;
  pedido_id: string | null;
  pedido_codigo: string | null;
  otro_usuario_id: string | null;
  otro_usuario_rol: Rol | null;
  miembros: number;
  ultimo_mensaje_en: string | null;
  ultimo_texto: string | null;
  ultimo_autor: string | null;
  ultimo_autor_id: string | null;
  ultimo_adjuntos: number;
  sin_leer: number;
  menciones_sin_leer: number;
}

export const aResumen = (f: FilaResumen): ResumenConversacion => ({
  id: f.id,
  tipo: f.tipo,
  nombre: f.nombre ?? (f.tipo === "general" ? "General" : "—"),
  descripcion: f.descripcion,
  pedidoId: f.pedido_id,
  pedidoCodigo: f.pedido_codigo,
  otroUsuarioId: f.otro_usuario_id,
  otroUsuarioRol: f.otro_usuario_rol,
  miembros: f.miembros,
  ultimoMensajeEn: f.ultimo_mensaje_en,
  ultimoTexto: f.ultimo_texto,
  ultimoAutor: f.ultimo_autor,
  ultimoAutorId: f.ultimo_autor_id,
  ultimoAdjuntos: f.ultimo_adjuntos,
  sinLeer: f.sin_leer,
  mencionesSinLeer: f.menciones_sin_leer,
});

/** Una persona activa (`directorio_usuarios()`). */
export interface UsuarioDirectorio {
  id: string;
  nombre: string;
  usuario: string;
  rol: Rol;
}

/** Quién participa de una conversación y desde cuándo (`participantes_conversacion()`). */
export interface Participante {
  usuarioId: string;
  nombre: string;
  rol: Rol;
  /** Los mensajes de antes de esto no eran para esta persona: no cuentan para el doble check. */
  desde: string;
}

// ── Referencias (@) ──────────────────────────────────────────────────────────

export type TipoReferencia = "cliente" | "pedido" | "plancha" | "diseno" | "usuario";

export const TIPOS_REFERENCIA: Record<TipoReferencia, { nombre: string; comando: string; ayuda: string }> = {
  cliente: { nombre: "Cliente", comando: "cliente", ayuda: "Por nombre, teléfono o DNI/RUC" },
  pedido: { nombre: "Pedido", comando: "pedido", ayuda: "Por código" },
  plancha: { nombre: "Plancha", comando: "plancha", ayuda: "Material › color › espesor › formato, o código" },
  diseno: { nombre: "Diseño 3D", comando: "diseno3D", ayuda: "Por nombre, o cliente › pedido › ítem" },
  usuario: { nombre: "Usuario", comando: "usuario", ayuda: "Por nombre" },
};

export const ORDEN_TIPOS: TipoReferencia[] = ["cliente", "pedido", "plancha", "diseno", "usuario"];

const esquemaTipo = z.enum(["cliente", "pedido", "plancha", "diseno", "usuario"]);

/** La entidad de la que "cuelga" una referencia al encadenar: `@cliente X @pedido`. */
export const esquemaContexto = z.object({
  tipo: esquemaTipo,
  id: z.string().min(1).max(120),
  etiqueta: z.string().min(1).max(160),
});
export type ContextoReferencia = z.infer<typeof esquemaContexto>;

export const esquemaReferencia = z.object({
  /** Cómo se nombra en el texto, sin la arroba: `r1` → `@r1`. */
  alias: z.string().regex(/^r\d{1,2}$/),
  tipo: esquemaTipo,
  id: z.string().trim().min(1).max(120),
  /** Lo que se lee en la ficha: "P2611-001", "Juan Pérez", "Acrílico · Cristal · 3 mm". */
  etiqueta: z.string().trim().min(1).max(160),
  /** Una segunda línea opcional: "DNI 12345678", "Entregado", "122 × 244 cm". */
  detalle: z.string().max(200).optional(),
  /** Desde dónde se eligió, si se encadenó (`@cliente X @pedido` → [cliente X]). */
  contexto: z.array(esquemaContexto).max(4).optional(),
  /** Datos sueltos para la ficha (versión del diseño, código de plancha…). Sin nada sensible. */
  datos: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type Referencia = z.infer<typeof esquemaReferencia>;

export const MAX_REFERENCIAS = 20;
export const esquemaReferencias = z.array(esquemaReferencia).max(MAX_REFERENCIAS);

/** Las fichas `@rN` de un texto. */
export const PATRON_REFERENCIA = /@(r\d{1,2})\b/g;

/** Los alias (`r1`…) que aparecen como `@rN` en el texto. */
export const aliasEnTexto = (texto: string) =>
  new Set([...texto.matchAll(PATRON_REFERENCIA)].map((m) => m[1]));

/** El primer alias libre: `r1`, `r2`… */
export function siguienteAlias(usados: Iterable<string>): string {
  const ocupados = new Set(usados);
  let n = 1;
  while (ocupados.has(`r${n}`)) n++;
  return `r${n}`;
}

/** Solo las referencias que siguen nombradas en el texto (al borrar `@r2` a mano, se va). */
export const referenciasUsadas = (texto: string, referencias: Referencia[]) => {
  const usados = aliasEnTexto(texto);
  return referencias.filter((r) => usados.has(r.alias));
};

/** El texto partido en trozos de texto y fichas, para pintarlo. Un `@rN` sin referencia queda como texto. */
export function partirReferencias(texto: string, referencias: Referencia[]): (string | Referencia)[] {
  const porAlias = new Map(referencias.map((r) => [r.alias, r]));
  const trozos: (string | Referencia)[] = [];
  let desde = 0;
  for (const m of texto.matchAll(PATRON_REFERENCIA)) {
    const ref = porAlias.get(m[1]);
    if (!ref) continue;
    if (m.index > desde) trozos.push(texto.slice(desde, m.index));
    trozos.push(ref);
    desde = m.index + m[0].length;
  }
  if (desde < texto.length) trozos.push(texto.slice(desde));
  return trozos;
}

/** El texto con cada ficha cambiada por `@etiqueta` (vista previa, avisos, copiar). */
export const textoPlano = (texto: string, referencias: Referencia[]) =>
  partirReferencias(texto, referencias)
    .map((t) => (typeof t === "string" ? t : `@${t.etiqueta}`))
    .join("");

/** Lee `referencias` de la base sin fiarse: lo que no valida se descarta. */
export function leerReferencias(valor: unknown): Referencia[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((v) => {
    const r = esquemaReferencia.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

// ── Mensajes y adjuntos ──────────────────────────────────────────────────────

export const MAX_TEXTO = 4000;
export const MAX_ADJUNTOS = 10;
/** 50 MiB por archivo, igual que el bucket `chat`. */
export const MAX_BYTES_ADJUNTO = 50 * 1024 * 1024;
export const BUCKET_CHAT = "chat";

export const MIME_CHAT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/3gpp",
  "application/pdf",
] as const;

/** Para el `accept` del `<input type="file">`. */
export const ACEPTA_CHAT = "image/*,video/*,application/pdf";

export const esImagen = (mime: string) => mime.startsWith("image/");
export const esVideo = (mime: string) => mime.startsWith("video/");

export interface Adjunto {
  id: string;
  mensajeId: string;
  ruta: string;
  nombre: string;
  mime: string;
  tamano: number;
  ancho: number | null;
  alto: number | null;
  duracionS: number | null;
  posicion: number;
}

export interface FilaAdjunto {
  id: string;
  mensaje_id: string;
  storage_path: string;
  nombre: string;
  mime: string;
  tamano: number;
  ancho: number | null;
  alto: number | null;
  duracion_s: number | null;
  posicion: number;
}

export const COLUMNAS_ADJUNTO = "id, mensaje_id, storage_path, nombre, mime, tamano, ancho, alto, duracion_s, posicion";

export const aAdjunto = (f: FilaAdjunto): Adjunto => ({
  id: f.id,
  mensajeId: f.mensaje_id,
  ruta: f.storage_path,
  nombre: f.nombre,
  mime: f.mime,
  tamano: f.tamano,
  ancho: f.ancho,
  alto: f.alto,
  duracionS: f.duracion_s,
  posicion: f.posicion,
});

export interface Mensaje {
  id: string;
  conversacionId: string;
  autorId: string;
  autor: string;
  rol: Rol | null;
  texto: string;
  referencias: Referencia[];
  /** El `timestamptz` tal cual llega de Postgres. */
  creadoEn: string;
  adjuntos: Adjunto[];
}

export interface FilaMensaje {
  id: string;
  conversacion_id: string;
  autor_id: string;
  autor_nombre: string;
  autor_rol: Rol | null;
  texto: string;
  referencias: unknown;
  creado_en: string;
}

export const COLUMNAS_MENSAJE = "id, conversacion_id, autor_id, autor_nombre, autor_rol, texto, referencias, creado_en";

export const aMensaje = (f: FilaMensaje, adjuntos: Adjunto[] = []): Mensaje => ({
  id: f.id,
  conversacionId: f.conversacion_id,
  autorId: f.autor_id,
  autor: f.autor_nombre || "—",
  rol: f.autor_rol,
  texto: f.texto,
  referencias: leerReferencias(f.referencias),
  creadoEn: f.creado_en,
  adjuntos: [...adjuntos].sort((a, b) => a.posicion - b.posicion),
});

/** Quién vio un mensaje (`mensaje_lecturas`). */
export interface Lectura {
  mensajeId: string;
  usuarioId: string;
  leidoEn: string;
}

export const COLUMNAS_LECTURA = "mensaje_id, usuario_id, leido_en";

export const aLectura = (f: { mensaje_id: string; usuario_id: string; leido_en: string }): Lectura => ({
  mensajeId: f.mensaje_id,
  usuarioId: f.usuario_id,
  leidoEn: f.leido_en,
});

/**
 * Para quién era un mensaje: quienes participan desde antes de que se enviara,
 * menos quien lo escribió. El doble check se pone azul cuando todos lo vieron.
 */
export const destinatariosDe = (m: Pick<Mensaje, "autorId" | "creadoEn">, participantes: Participante[]) => {
  // Por fecha y no por texto: Postgres no siempre manda la misma cantidad de decimales.
  const enviado = Date.parse(m.creadoEn);
  return participantes.filter((p) => p.usuarioId !== m.autorId && Date.parse(p.desde) <= enviado);
};

export type EstadoEntrega = "enviando" | "enviado" | "visto";

export function estadoDeEntrega(
  m: Pick<Mensaje, "id" | "autorId" | "creadoEn">,
  participantes: Participante[],
  lecturas: Lectura[],
): EstadoEntrega {
  const para = destinatariosDe(m, participantes);
  if (para.length === 0) return "enviado";
  const vieron = new Set(lecturas.filter((l) => l.mensajeId === m.id).map((l) => l.usuarioId));
  return para.every((p) => vieron.has(p.usuarioId)) ? "visto" : "enviado";
}
