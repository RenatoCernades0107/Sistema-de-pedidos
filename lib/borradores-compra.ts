import type { DatosBorradorCompra, ResumenBorrador } from "./borradores";

/**
 * Borrador del editor de "Nueva compra": lo puro (sin React ni servidor).
 *
 * Es el formulario a medio llenar, no una pre-compra: no se valida (la pre-compra
 * guardada en `compras` sí exige proveedor, almacén e ítems completos).
 */

/** Lo escrito como número (acepta coma decimal), o `null`. */
function numero(t: string): number | null {
  const limpio = t.trim().replace(/\s/g, "").replace(",", ".");
  if (!limpio) return null;
  const v = Number(limpio);
  return Number.isFinite(v) ? v : null;
}

/**
 * ¿La persona ya escribió o eligió algo? Lo que el formulario trae de fábrica
 * (tipo nacional, soles, contado, tipos de cambio sugeridos) no cuenta.
 */
export function compraTieneContenido(
  d: Pick<DatosBorradorCompra, "proveedor" | "almacenId" | "documento" | "dias" | "embarque" | "llegada" | "nota" | "filas">,
): boolean {
  return (
    !!d.proveedor ||
    !!d.almacenId ||
    d.filas.length > 0 ||
    [d.documento, d.dias, d.embarque, d.llegada, d.nota].some((t) => t.trim() !== "")
  );
}

/** Lo que muestra la lista de borradores: el proveedor, cuántos ítems y la mercadería. */
export function resumenDeCompra(d: Pick<DatosBorradorCompra, "proveedor" | "filas" | "moneda">): ResumenBorrador {
  const total = d.filas.reduce((t, f) => t + (numero(f.cantidad) ?? 0) * (numero(f.precio) ?? 0), 0);
  return {
    cliente: d.proveedor?.nombre ?? null,
    productos: d.filas.length,
    total: Math.round(total * 100) / 100,
    moneda: d.moneda,
  };
}
