/**
 * Exportación de pedidos a CSV, una fila por pedido con todo su detalle.
 *
 * Exporta lo que el rol ya ve en pantalla, no más: las columnas de cliente,
 * teléfono, montos, envío y auditoría salen solo si el permiso las habilita. Es
 * la misma regla que `detalle-pedido.tsx`; si un rol no puede leer un dato en la
 * pantalla, tampoco se lo lleva en un archivo.
 *
 * Las colecciones (abonos, historial, adjuntos, auditoría) no caben en columnas,
 * así que van en una sola celda, un elemento por línea.
 */

import {
  ADJUNTOS,
  ESTADOS,
  LUGARES,
  METODOS,
  PAGOS,
  PRODUCTOS,
  ROLES,
  UBICACIONES,
  etiquetaTipos,
  saldoDe,
  unidadDe,
  venceCreditoEl,
  type Pedido,
  type PermisosRol,
} from "./dominio";
import { fechaCompleta, fechaHora } from "./formato";

type Celda = string | number | null | undefined;
type Visibilidad = Pick<
  PermisosRol,
  "verCliente" | "verTelefonoCliente" | "verMontos" | "verEnvioCompleto" | "verAuditoria"
>;

interface Columna {
  titulo: string;
  /** Si falta, la columna la ve todo el que ve pedidos. */
  visible?: (v: Visibilidad) => boolean;
  valor: (p: Pedido) => Celda;
}

const fecha = (iso: string | null | undefined) => (iso ? fechaCompleta(iso) : "");
const dinero = (n: number) => n.toFixed(2);
const lineas = (xs: string[]) => xs.join("\n");

const COLUMNAS: Columna[] = [
  { titulo: "Código", valor: (p) => p.codigo },
  { titulo: "Cliente", visible: (v) => v.verCliente, valor: (p) => p.cliente },
  { titulo: "Teléfono del cliente", visible: (v) => v.verTelefonoCliente, valor: (p) => p.telefonoCliente },
  { titulo: "Tipo de pedido", valor: (p) => etiquetaTipos(p.tipos) },
  { titulo: "Producto terminado", valor: (p) => (p.producto ? PRODUCTOS[p.producto] : "") },
  { titulo: "Cantidad", valor: (p) => p.cantidad },
  { titulo: "Unidad", valor: (p) => unidadDe(p.tipos) },
  { titulo: "Estado", valor: (p) => ESTADOS[p.estado] },
  { titulo: "Motivo", valor: (p) => p.motivo },
  { titulo: "Ubicación", valor: (p) => UBICACIONES[p.ubicacion] },
  { titulo: "Lugar de entrega", valor: (p) => LUGARES[p.entrega] },
  { titulo: "Dirección de entrega", valor: (p) => p.direccion },
  { titulo: "Responsable", valor: (p) => p.responsable },
  { titulo: "Fecha de registro", valor: (p) => fecha(p.fechaCreacion) },
  { titulo: "Fecha prometida", valor: (p) => fecha(p.fechaPrometida) },
  { titulo: "Fecha de entrega", valor: (p) => fecha(p.fechaEntrega) },
  { titulo: "Fecha de anulación", valor: (p) => fecha(p.fechaAnulacion) },
  { titulo: "Detalle", valor: (p) => p.detalle },
  { titulo: "Observaciones", valor: (p) => p.observaciones },
  { titulo: "Envío a provincia", valor: (p) => (p.esProvincia ? "Sí" : "No") },
  { titulo: "Departamento", valor: (p) => p.envio?.departamento },
  { titulo: "Provincia", valor: (p) => p.envio?.provincia },
  { titulo: "Agencia", visible: (v) => v.verEnvioCompleto, valor: (p) => p.envio?.agencia },
  { titulo: "Persona que recoge", visible: (v) => v.verEnvioCompleto, valor: (p) => p.envio?.personaQueRecoge },
  {
    titulo: "Documento de quien recoge",
    visible: (v) => v.verEnvioCompleto,
    valor: (p) =>
      p.envio?.numeroDocumento ? `${p.envio.tipoDocumento} ${p.envio.numeroDocumento}` : "",
  },
  { titulo: "Teléfono de quien recoge", visible: (v) => v.verEnvioCompleto, valor: (p) => p.envio?.telefono },
  {
    titulo: "Flete",
    visible: (v) => v.verEnvioCompleto,
    valor: (p) => (p.envio && p.envio.montoFlete > 0 ? dinero(p.envio.montoFlete) : ""),
  },
  {
    titulo: "Flete pagado",
    visible: (v) => v.verEnvioCompleto,
    valor: (p) => (p.envio && p.envio.montoFlete > 0 ? (p.envio.fletePagado ? "Sí" : "No") : ""),
  },
  { titulo: "Observaciones del envío", visible: (v) => v.verEnvioCompleto, valor: (p) => p.envio?.observacionesEnvio },
  { titulo: "Tipo de pago", visible: (v) => v.verMontos, valor: (p) => PAGOS[p.tipoPago] },
  {
    titulo: "Plazo de crédito (días)",
    visible: (v) => v.verMontos,
    valor: (p) => p.plazoCredito,
  },
  {
    titulo: "Vence el crédito",
    visible: (v) => v.verMontos,
    valor: (p) => fecha(venceCreditoEl(p)),
  },
  { titulo: "Monto total", visible: (v) => v.verMontos, valor: (p) => dinero(p.montoTotal) },
  { titulo: "Monto pagado", visible: (v) => v.verMontos, valor: (p) => dinero(p.montoPagado) },
  { titulo: "Saldo", visible: (v) => v.verMontos, valor: (p) => dinero(saldoDe(p)) },
  {
    titulo: "Abonos",
    visible: (v) => v.verMontos,
    valor: (p) =>
      lineas(
        p.abonos.map(
          (a) => `${fecha(a.fecha)} · S/ ${dinero(a.monto)} · ${METODOS[a.metodo]} · ${a.usuario}`,
        ),
      ),
  },
  // Solo Administración lee el número: para los demás llega vacío.
  { titulo: "Comprobante", visible: (v) => v.verMontos, valor: (p) => p.numeroComprobante },
  {
    titulo: "Archivos adjuntos",
    valor: (p) => lineas(p.adjuntos.map((a) => `${ADJUNTOS[a.tipo]}: ${a.nombre} (${a.peso})`)),
  },
  {
    titulo: "Historial de estados",
    valor: (p) =>
      lineas(
        p.historial.map(
          (h) =>
            `${fechaHora(h.fecha)} · ${ESTADOS[h.estado]} · ${h.usuario} (${ROLES[h.rol].nombre})` +
            (h.motivo ? ` · ${h.motivo}` : ""),
        ),
      ),
  },
  {
    titulo: "Auditoría",
    visible: (v) => v.verAuditoria,
    valor: (p) =>
      lineas(
        p.auditoria.map(
          (a) => `${fechaHora(a.fecha)} · ${a.usuario} · ${a.campo}: ${a.anterior} → ${a.nuevo}`,
        ),
      ),
  },
];

/** Un importe negativo (saldo a favor) es un número, no una fórmula. */
const NUMERO = /^-\d+(\.\d+)?$/;

/**
 * Una celda lista para el CSV. Excel y Calc ejecutan como fórmula lo que empieza
 * por `=`, `+`, `-` o `@`: un detalle de pedido tecleado por un cliente no debe
 * poder hacerlo, así que el texto (nunca un número) que arranca así lleva una
 * comilla delante.
 */
export function celdaCsv(v: Celda): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !NUMERO.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * El CSV completo. Empieza con BOM para que Excel lo abra como UTF-8 (sin él, las
 * tildes y las ñ salen rotas) y termina las filas con CRLF, como pide el RFC 4180.
 */
export function pedidosACsv(pedidos: Pedido[], permisos: Visibilidad): string {
  const columnas = COLUMNAS.filter((c) => c.visible?.(permisos) ?? true);
  const filas = [
    columnas.map((c) => celdaCsv(c.titulo)),
    ...pedidos.map((p) => columnas.map((c) => celdaCsv(c.valor(p)))),
  ];
  return `﻿${filas.map((f) => f.join(",")).join("\r\n")}\r\n`;
}

/** `pedidos-2026-08-31.csv` */
export const nombreArchivoCsv = (hoy: string) => `pedidos-${hoy}.csv`;

/** Baja el CSV en el navegador. Solo corre en el cliente. */
export function descargarCsv(contenido: string, nombre: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
