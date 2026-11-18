/**
 * Lo que las pruebas del almacén le preguntan o le hacen al Odoo falso
 * (`e2e/odoo-falso.mts`) directamente, como si alguien trabajara en Odoo.
 */

import type { Page } from "@playwright/test";

export const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";
// Las credenciales del Odoo falso (`e2e/odoo-falso.mts`, que no se puede importar desde aquí).
const BASE = "e2e-odoo-falso";
const USUARIO = "e2e@plexiacril.test";
const CLAVE = "clave-del-odoo-falso";

type Registro = Record<string, unknown> & { id: number };
export interface EstadoOdoo {
  productos: (Registro & { default_code: string | false; __stock?: Record<number, number> })[];
  almacenes: (Registro & { code: string; lot_stock_id: [number, string] })[];
  pickings: (Registro & { origin: string | false; state: string })[];
  quants: { lot_id: [number, string] | false; location_id: [number, string]; quantity: number }[];
}

export const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as EstadoOdoo;
export const ubicacionDe = async (codigo: string) => (await estado()).almacenes.find((a) => a.code === codigo)!.lot_stock_id[0];
export const stockEn = async (producto: string, almacen: string) => {
  const p = (await estado()).productos.find((x) => x.default_code === producto)!;
  return p.__stock?.[await ubicacionDe(almacen)] ?? 0;
};

export async function rpc(modelo: string, metodo: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  const llamar = async (params: unknown) => {
    const r = await fetch(`${ODOO}/jsonrpc`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params }),
    });
    const j = (await r.json()) as { result?: unknown; error?: { data: { message: string } } };
    if (j.error) throw new Error(j.error.data.message);
    return j.result;
  };
  const uid = await llamar({ service: "common", method: "authenticate", args: [BASE, USUARIO, CLAVE, {}] });
  return llamar({ service: "object", method: "execute_kw", args: [BASE, uid, CLAVE, modelo, metodo, args, kwargs] });
}

/** Pone `cantidad` de un producto en un almacén del Odoo falso, como un inventario hecho en Odoo. */
export async function contar(codigo: string, almacen: string, cantidad: number) {
  const producto = (await estado()).productos.find((p) => p.default_code === codigo)!;
  const contexto = { context: { inventory_mode: true } };
  const quant = await rpc(
    "stock.quant",
    "create",
    [{ product_id: producto.id, location_id: await ubicacionDe(almacen), inventory_quantity: cantidad }],
    contexto,
  );
  await rpc("stock.quant", "action_apply_inventory", [[quant]], contexto);
}

/** Elige una opción de un Select de Base UI, por la etiqueta del disparador. */
export async function elegir(page: Page, dentro: ReturnType<Page["getByRole"]>, etiqueta: string, opcion: string) {
  await dentro.getByRole("combobox", { name: etiqueta }).click();
  await page.getByRole("option", { name: opcion, exact: true }).click();
}
