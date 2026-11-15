import type { Rol } from "./dominio";

/** Un mensaje del chat de un pedido (`pedido_mensajes`). */
export interface MensajePedido {
  id: string;
  autorId: string;
  autor: string;
  rol: Rol | null;
  texto: string;
  /** El `timestamptz` tal cual llega de Postgres. */
  creadoEn: string;
}

export interface FilaMensaje {
  id: string;
  autor_id: string;
  autor_nombre: string;
  autor_rol: Rol | null;
  texto: string;
  creado_en: string;
}

export const COLUMNAS_MENSAJE = "id, autor_id, autor_nombre, autor_rol, texto, creado_en";

export const aMensaje = (f: FilaMensaje): MensajePedido => ({
  id: f.id,
  autorId: f.autor_id,
  autor: f.autor_nombre || "—",
  rol: f.autor_rol,
  texto: f.texto,
  creadoEn: f.creado_en,
});

