/**
 * Búsqueda de pedidos. Una sola fuente para la lista y el ⌘K.
 *
 * En mostrador el cliente dicta el código de memoria ("ele-ce-ele dos mil veintiséis…")
 * y el nombre de la empresa casi nunca llega con las tildes puestas. Así que
 * ni los separadores del código ni los acentos pueden decidir si algo aparece.
 */

import { PRODUCTOS, TIPOS, type PermisosRol, type Pedido } from "./dominio";

/**
 * Baja a minúsculas, quita acentos y unifica `_`, `-` y espacios.
 * "LCL_2026_H4TP" y "lcl 2026 h4tp" acaban siendo el mismo texto.
 */
export const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[_\-\s]+/g, " ")
    .trim();

/**
 * Cada palabra de la consulta tiene que estar en el texto, en cualquier orden:
 * "andina laser" encuentra "Corporación Andina SAC · Corte láser".
 */
export function coincide(texto: string, consulta: string) {
  const q = normalizar(consulta);
  if (!q) return true;
  const t = normalizar(texto);
  return q.split(" ").every((palabra) => t.includes(palabra));
}

/** Lo que el rol decide que se puede leer. Un subconjunto de `PermisosRol`. */
type Visibilidad = Pick<PermisosRol, "verCliente" | "verTelefonoCliente" | "verEnvioCompleto">;

const TODO: Visibilidad = { verCliente: true, verTelefonoCliente: true, verEnvioCompleto: true };

/**
 * Todo lo que de un pedido tiene sentido escribir en un buscador.
 *
 * El rol recorta la lista: un campo que la vista esconde tampoco se busca. Un
 * buscador que acierta con un nombre oculto lo acaba revelando igual, y basta
 * teclear letras hasta que quede un solo resultado.
 */
export function camposBuscables(p: Pedido, permisos: Visibilidad = TODO) {
  return [
    p.codigo,
    permisos.verCliente ? p.cliente : "",
    permisos.verTelefonoCliente ? (p.telefonoCliente ?? "") : "",
    ...p.tipos.map((t) => TIPOS[t]),
    p.producto ? PRODUCTOS[p.producto] : "",
    p.responsable ?? "",
    p.detalle,
    p.observaciones ?? "",
    p.numeroComprobante ?? "",
    p.envio?.departamento ?? "",
    p.envio?.provincia ?? "",
    ...(permisos.verEnvioCompleto
      ? [p.envio?.agencia ?? "", p.envio?.personaQueRecoge ?? ""]
      : []),
  ]
    .filter(Boolean)
    .join(" ");
}
