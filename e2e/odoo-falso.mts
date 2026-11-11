/**
 * Un Odoo de mentira, en memoria, para las pruebas.
 *
 * Habla la misma JSON-RPC que `lib/odoo/rpc.ts` (`POST /jsonrpc`, servicios
 * `common` y `object`) y entiende lo justo de los modelos que la app usa:
 * `res.partner`, `product.product`, `sale.order`, `sale.order.line`,
 * `stock.picking`, `stock.move`, `ir.model`, `res.country` y
 * `l10n_latam.identification.type`. Las entregas son como las de la 17: la
 * cantidad hecha de un movimiento es `quantity`, y `picked` la marca. Con eso las pruebas
 * recorren el camino real —el cliente de Odoo de la app, los route handlers, el
 * formulario— sin tocar el Odoo de la empresa.
 *
 * Además expone tres rutas para que las pruebas lo manejen:
 *   GET  /__estado     lo que hay y lo que le pidieron
 *   POST /__modo       { "modo": "caido" | "perder-respuesta" | null }
 *   POST /__reiniciar  vuelve a los datos sembrados
 *
 * Solo sintaxis de TypeScript que se puede borrar: Node lo corre tal cual
 * (`node e2e/odoo-falso.mts`) y Vitest lo importa.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

export const BASE = "e2e-odoo-falso";
export const USUARIO = "e2e@plexiacril.test";
export const CLAVE = "clave-del-odoo-falso";
const UID = 7;

type Registro = Record<string, unknown> & { id: number };

/**
 * `caido`: crear, confirmar o cancelar una venta, o validar su entrega, falla
 * con un error de Odoo.
 * `perder-respuesta`: la cotización SÍ se crea, pero la respuesta llega como
 * error — lo que pasa cuando se corta la red justo después. Es el caso que
 * obliga a que reintentar no duplique.
 */
export type Modo = "caido" | "perder-respuesta" | null;

interface Llamada {
  modelo: string;
  metodo: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

type EntregaFalsa = Registro & { movimientos: Registro[] };

const ahora = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/* ── Datos sembrados ───────────────────────────────────────────────────────── */

function sembrar() {
  const t = "2026-11-01 10:00:00";
  const partners: Registro[] = [
    {
      id: 1, name: "E2E José Pérez Quispe", vat: "45678912", phone: "987 654 321",
      email: false, city: "Lima", is_company: false, parent_id: false, active: true, write_date: t,
    },
    {
      id: 2, name: "E2E Corporación Andina SAC", vat: "20123456786", phone: "01 555 1234",
      email: "compras@andina.test", city: "Lima", is_company: true, parent_id: false, active: true, write_date: t,
    },
    {
      id: 3, name: "E2E Ñuñez Talleres EIRL", vat: "20601234565", phone: false,
      email: false, city: "Arequipa", is_company: true, parent_id: false, active: true, write_date: t,
    },
    {
      id: 4, name: "E2E Archivado", vat: "11111111", phone: false, email: false, city: false,
      is_company: false, parent_id: false, active: false, write_date: t,
    },
  ];

  const producto = (
    id: number, codigo: string | false, nombre: string, precio: number,
    extra: Partial<Registro> = {},
  ): Registro => ({
    id,
    name: nombre,
    display_name: codigo ? `[${codigo}] ${nombre}` : nombre,
    default_code: codigo,
    barcode: false,
    lst_price: precio,
    uom_id: [1, "Unidades"],
    categ_id: [1, "Acrílicos"],
    active: true,
    sale_ok: true,
    write_date: t,
    ...extra,
  });

  const products: Registro[] = [
    producto(10, "AC-003", "ACRILICO F8 CRISTAL 3MM", 120, { barcode: "7750000000031" }),
    producto(11, "AC-005", "ACRILICO F8 CRISTAL 5MM", 190),
    producto(12, "AC-103", "ACRILICO BRONCE 3MM", 135),
    producto(13, "PVC-010", "PVC ESPUMADO BLANCO 10MM", 95, { categ_id: [2, "PVC"] }),
    producto(14, "SRV-CL", "SERVICIO CORTE LASER", 1.5, { uom_id: [2, "Minutos"], categ_id: [3, "Servicios"] }),
    // Planchas del catálogo (`formatos_plancha`), con su stock, y los servicios de corte.
    producto(20, "F7E024", "ACRILICO ECO CRISTAL 3MM 1.22X1.83", 200, { qty_available: 10, free_qty: 10 }),
    producto(21, "F9.5E015", "ACRILICO ECO CRISTAL 3MM 1.22X2.44", 265, { qty_available: 2, free_qty: 1 }),
    producto(22, "F15E004", "ACRILICO ECO CRISTAL 3MM 1.50X3.00", 400, { qty_available: 0, free_qty: 0 }),
    producto(23, "F20E004", "ACRILICO ECO CRISTAL 3MM 2.05X3.05", 560, { qty_available: 5, free_qty: 5 }),
    producto(24, "F7E029", "ACRILICO ECO COLORES 3MM 1.22X1.83", 230, { qty_available: 7, free_qty: 7 }),
    producto(30, "SRV001", "SERVICIO DE CORTE MANUAL", 1, { uom_id: [1, "Unidades"], categ_id: [3, "Servicios"] }),
    producto(31, "SRV002", "SERVICIO DE CORTE LASER", 1, { uom_id: [1, "Unidades"], categ_id: [3, "Servicios"] }),
    // Solo existe aquí: la prueba e2e lo busca para saber que la app habla con este Odoo.
    producto(15, "E2E-ZZ9", "E2E PRODUCTO SOLO EN EL ODOO FALSO", 1),
    producto(16, "NO-VENTA", "INSUMO INTERNO", 10, { sale_ok: false }),
  ];

  return {
    "res.partner": partners,
    "product.product": products,
    "product.category": [
      { id: 1, name: "Acrílicos" }, { id: 2, name: "PVC" }, { id: 3, name: "Servicios" },
    ] as Registro[],
    "sale.order": [] as Registro[],
    "sale.order.line": [] as Registro[],
    "stock.picking": [] as Registro[],
    "stock.move": [] as Registro[],
    "res.country": [{ id: 173, code: "PE", name: "Perú" }] as Registro[],
    "l10n_latam.identification.type": [
      { id: 4, name: "RUC", l10n_pe_vat_code: "6" },
      { id: 5, name: "DNI", l10n_pe_vat_code: "1" },
      { id: 6, name: "Pasaporte", l10n_pe_vat_code: "7" },
    ] as Registro[],
    "ir.model": [
      { id: 1, model: "res.partner" },
      { id: 2, model: "product.product" },
      { id: 3, model: "sale.order" },
      { id: 4, model: "l10n_latam.identification.type" },
    ] as Registro[],
  };
}

/** Los campos que "existen" en cada modelo. `res.partner` sin `mobile`, como en las versiones nuevas. */
const CAMPOS: Record<string, string[]> = {
  "res.partner": [
    "name", "vat", "phone", "email", "city", "is_company", "parent_id", "write_date", "active",
    "country_id", "l10n_latam_identification_type_id", "customer_rank",
  ],
  "product.product": [
    "name", "display_name", "default_code", "barcode", "lst_price", "uom_id", "categ_id",
    "write_date", "active", "sale_ok", "product_tmpl_id", "qty_available", "free_qty",
  ],
  "product.template": [
    "name", "default_code", "list_price", "sale_ok", "categ_id", "uom_id", "active", "write_date",
  ],
  "product.category": ["name"],
  "sale.order": ["name", "partner_id", "origin", "order_line", "amount_untaxed", "amount_tax", "amount_total", "state"],
  "sale.order.line": ["order_id", "product_id", "name", "product_uom_qty", "price_unit", "display_type", "sequence"],
  "stock.picking": ["name", "sale_id", "picking_type_code", "state", "move_ids"],
  "stock.move": ["picking_id", "product_id", "product_uom_qty", "quantity", "picked", "state", "sale_line_id"],
  "l10n_latam.identification.type": ["name", "l10n_pe_vat_code", "country_id"],
};

/* ── Dominios ──────────────────────────────────────────────────────────────── */

type Predicado = (r: Registro) => boolean;

function valorDe(r: Registro, campo: string): unknown {
  // `product_tmpl_id.write_date`: aquí la plantilla y la variante son lo mismo.
  if (campo === "product_tmpl_id.write_date") return r.write_date;
  const v = r[campo];
  return Array.isArray(v) ? v[0] : v;
}

function termino([campo, op, valor]: [string, string, unknown]): Predicado {
  return (r) => {
    const v = valorDe(r, campo);
    switch (op) {
      case "=":
        return v === valor || (valor === false && (v === undefined || v === null));
      case "!=":
        return v !== valor;
      case "in":
        return (valor as unknown[]).includes(v);
      case "not in":
        return !(valor as unknown[]).includes(v);
      case "ilike":
        return typeof v === "string" && v.toLowerCase().includes(String(valor).toLowerCase());
      case "=ilike":
        return typeof v === "string" && v.toLowerCase() === String(valor).toLowerCase();
      case ">=":
        return typeof v === "string" && v >= String(valor);
      case ">":
        return typeof v === "string" && v > String(valor);
      default:
        throw new Error(`Operador no soportado por el Odoo falso: ${op}`);
    }
  };
}

/** Notación polaca de Odoo, con AND implícito entre expresiones seguidas. */
export function evaluarDominio(dominio: unknown[]): Predicado {
  let i = 0;
  const expresion = (): Predicado => {
    const t = dominio[i++];
    if (t === "&" || t === "|") {
      const a = expresion();
      const b = expresion();
      return t === "&" ? (r) => a(r) && b(r) : (r) => a(r) || b(r);
    }
    if (t === "!") {
      const a = expresion();
      return (r) => !a(r);
    }
    return termino(t as [string, string, unknown]);
  };
  const todas: Predicado[] = [];
  while (i < dominio.length) todas.push(expresion());
  return (r) => todas.every((p) => p(r));
}

/** Sin `active` en el dominio, Odoo esconde los archivados. */
function conActivos(modelo: string, dominio: unknown[]): Predicado {
  const p = evaluarDominio(dominio);
  const mencionaActive = JSON.stringify(dominio).includes('"active"');
  const tieneActive = (CAMPOS[modelo] ?? []).includes("active");
  return (r) => p(r) && (mencionaActive || !tieneActive || r.active !== false);
}

/* ── El servidor ───────────────────────────────────────────────────────────── */

class ErrorRpc extends Error {
  tipo: string;
  constructor(tipo: string, mensaje: string) {
    super(mensaje);
    this.tipo = tipo;
  }
}

export async function crearOdooFalso(opciones: { puerto?: number } = {}) {
  let datos = sembrar();
  let modo: Modo = null;
  let llamadas: Llamada[] = [];

  const tabla = (modelo: string) => {
    // Aquí plantilla y variante son el mismo registro (lo usa scripts/seed-odoo.mjs).
    if (modelo === "product.template") modelo = "product.product";
    const t = (datos as Record<string, Registro[]>)[modelo];
    if (!t) throw new ErrorRpc("builtins.KeyError", `Modelo desconocido: ${modelo}`);
    return t;
  };

  const elegir = (r: Registro, campos?: unknown) => {
    if (!Array.isArray(campos) || campos.length === 0) return { ...r };
    const salida: Registro = { id: r.id };
    for (const c of campos as string[]) {
      if (!(CAMPOS[r.__modelo as string] ?? Object.keys(r)).includes(c) && !(c in r)) {
        throw new ErrorRpc("ValueError", `Invalid field '${c}'`);
      }
      salida[c] = c in r ? r[c] : false;
    }
    return salida;
  };

  const siguienteId = (t: Registro[]) => t.reduce((m, r) => Math.max(m, r.id), 0) + 1;

  function crear(modelo: string, vals: Record<string, unknown>): number {
    const t = tabla(modelo);
    const id = siguienteId(t);

    if (modelo === "res.partner") {
      const tipo = vals.l10n_latam_identification_type_id;
      const vat = String(vals.vat ?? "");
      if (tipo === 4 && vat.length !== 11) {
        throw new ErrorRpc("odoo.exceptions.ValidationError", `El RUC ${vat} no es válido.`);
      }
      if (tipo === 5 && vat.length !== 8) {
        throw new ErrorRpc("odoo.exceptions.ValidationError", `El DNI ${vat} no es válido.`);
      }
      t.push({
        id, name: vals.name, vat: vals.vat ?? false, phone: vals.phone ?? false, email: vals.email ?? false,
        city: false, is_company: vals.is_company ?? false, parent_id: false, active: true,
        country_id: vals.country_id ?? false, l10n_latam_identification_type_id: tipo ?? false,
        write_date: ahora(),
      });
      return id;
    }

    if (modelo === "sale.order") {
      if (modo === "caido") {
        throw new ErrorRpc("odoo.exceptions.UserError", "Odoo falso: caído a propósito.");
      }
      const partner = tabla("res.partner").find((p) => p.id === vals.partner_id);
      if (!partner) throw new ErrorRpc("odoo.exceptions.MissingError", "El cliente no existe.");

      const lineas = tabla("sale.order.line");
      const idsLineas: number[] = [];
      let base = 0;
      for (const [n, comando] of (vals.order_line as unknown[][]).entries()) {
        const [codigo, , v] = comando as [number, number, Record<string, unknown>];
        if (codigo !== 0) throw new ErrorRpc("ValueError", "El Odoo falso solo entiende el comando 0.");
        const producto = tabla("product.product").find((p) => p.id === v.product_id);
        if (!producto) throw new ErrorRpc("odoo.exceptions.MissingError", "El producto no existe.");
        const idLinea = siguienteId(lineas);
        const qty = Number(v.product_uom_qty ?? 1);
        const precio = Number(v.price_unit ?? producto.lst_price);
        base += qty * precio;
        lineas.push({
          id: idLinea, order_id: [id, ""], product_id: [producto.id, producto.display_name],
          name: v.name ?? producto.display_name, product_uom_qty: qty, price_unit: precio,
          display_type: false, sequence: 10 + n,
        });
        idsLineas.push(idLinea);
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const nombre = `S${String(id).padStart(5, "0")}`;
      t.push({
        id, name: nombre, partner_id: [partner.id, partner.name], origin: vals.origin ?? false,
        order_line: idsLineas, amount_untaxed: r2(base), amount_tax: r2(base * 0.18),
        amount_total: r2(base * 1.18), state: "draft",
      });
      if (modo === "perder-respuesta") {
        throw new ErrorRpc("odoo.exceptions.UserError", "Odoo falso: se creó, pero la respuesta se perdió.");
      }
      return id;
    }

    if (modelo === "product.category") {
      t.push({ id, name: vals.name });
      return id;
    }

    if (modelo === "product.template") {
      const codigo = (vals.default_code as string) ?? false;
      t.push({
        id, name: vals.name, display_name: codigo ? `[${codigo}] ${vals.name}` : vals.name,
        default_code: codigo, barcode: false, lst_price: vals.list_price ?? 0,
        uom_id: [1, "Unidades"], categ_id: [vals.categ_id, ""], active: true,
        sale_ok: vals.sale_ok ?? true, write_date: ahora(),
      });
      return id;
    }

    throw new ErrorRpc("odoo.exceptions.AccessError", `El Odoo falso no crea ${modelo}.`);
  }

  /**
   * La entrega que nace al confirmar una venta: un movimiento por cada línea de
   * un producto almacenable. Aquí, almacenable es el que tiene `qty_available`.
   */
  function crearEntrega(orden: Registro) {
    const lineas = tabla("sale.order.line").filter((l) => (orden.order_line as number[]).includes(l.id));
    const productos = tabla("product.product");
    const almacenables = lineas.filter((l) => {
      const p = productos.find((x) => x.id === valorDe(l, "product_id"));
      return p && "qty_available" in p;
    });
    if (almacenables.length === 0) return;

    const entregas = tabla("stock.picking");
    const movimientos = tabla("stock.move");
    const id = siguienteId(entregas);
    const ids: number[] = [];
    for (const l of almacenables) {
      const idMov = siguienteId(movimientos);
      movimientos.push({
        id: idMov, picking_id: [id, ""], product_id: l.product_id, product_uom_qty: l.product_uom_qty,
        quantity: 0, picked: false, state: "assigned", sale_line_id: [l.id, ""],
      });
      ids.push(idMov);
    }
    entregas.push({
      id, name: `WH/OUT/${String(id).padStart(5, "0")}`, sale_id: [orden.id, orden.name],
      picking_type_code: "outgoing", state: "assigned", move_ids: ids,
    });
  }

  function ejecutar(modelo: string, metodo: string, args: unknown[], kwargs: Record<string, unknown>) {
    llamadas.push({ modelo, metodo, args, kwargs });
    const deModelo = () => tabla(modelo).map((r) => ({ ...r, __modelo: modelo }));
    const limpiar = (r: Registro) => {
      const resto: Record<string, unknown> = { ...r };
      delete resto.__modelo;
      return resto;
    };

    switch (metodo) {
      case "fields_get":
        return Object.fromEntries((CAMPOS[modelo] ?? []).map((c) => [c, { type: "char" }]));
      case "search_read": {
        const dominio = (args[0] as unknown[]) ?? [];
        const offset = Number(kwargs.offset ?? 0);
        const limite = kwargs.limit ? Number(kwargs.limit) : undefined;
        const filtrados = deModelo().filter(conActivos(modelo, dominio)).sort((a, b) => a.id - b.id);
        return filtrados
          .slice(offset, limite ? offset + limite : undefined)
          .map((r) => limpiar(elegir(r, kwargs.fields)));
      }
      case "search": {
        const ids = deModelo()
          .filter(conActivos(modelo, (args[0] as unknown[]) ?? []))
          .map((r) => r.id);
        return kwargs.limit ? ids.slice(0, Number(kwargs.limit)) : ids;
      }
      case "search_count":
        return deModelo().filter(conActivos(modelo, (args[0] as unknown[]) ?? [])).length;
      case "read": {
        const ids = args[0] as number[];
        return deModelo()
          .filter((r) => ids.includes(r.id))
          .map((r) => limpiar(elegir(r, kwargs.fields)));
      }
      case "create":
        return crear(modelo, args[0] as Record<string, unknown>);
      case "write": {
        const [ids, vals] = args as [number[], Record<string, unknown>];
        if (modelo !== "product.template") {
          // Lo demás (los movimientos de una entrega) se escribe tal cual, campo por campo.
          for (const r of tabla(modelo).filter((x) => ids.includes(x.id))) {
            for (const c of Object.keys(vals)) {
              if (!(CAMPOS[modelo] ?? []).includes(c)) throw new ErrorRpc("ValueError", `Invalid field '${c}'`);
            }
            Object.assign(r, vals);
          }
          return true;
        }
        for (const r of tabla(modelo).filter((r) => ids.includes(r.id))) {
          if ("name" in vals) r.name = vals.name;
          if ("list_price" in vals) r.lst_price = vals.list_price;
          if ("active" in vals) r.active = vals.active;
          if ("categ_id" in vals) r.categ_id = [vals.categ_id, ""];
          r.display_name = r.default_code ? `[${r.default_code}] ${r.name}` : r.name;
          r.write_date = ahora();
        }
        return true;
      }
      case "action_confirm": {
        // Como Odoo: confirmar pasa la cotización a pedido de venta, y una que ya
        // no está en borrador no se vuelve a confirmar.
        if (modelo !== "sale.order") break;
        if (modo === "caido") {
          throw new ErrorRpc("odoo.exceptions.UserError", "Odoo falso: caído a propósito.");
        }
        const ids = args[0] as number[];
        for (const orden of tabla(modelo).filter((r) => ids.includes(r.id))) {
          if (orden.state !== "draft" && orden.state !== "sent") {
            throw new ErrorRpc(
              "odoo.exceptions.UserError",
              "Some orders are not in a state requiring confirmation.",
            );
          }
          orden.state = "sale";
          crearEntrega(orden);
        }
        return true;
      }
      case "action_cancel": {
        if (modelo !== "sale.order") break;
        if (modo === "caido") {
          throw new ErrorRpc("odoo.exceptions.UserError", "Odoo falso: caído a propósito.");
        }
        const ids = args[0] as number[];
        const entregas = tabla("stock.picking").filter((p) => ids.includes(valorDe(p, "sale_id") as number));
        if (entregas.some((p) => p.state === "done")) {
          throw new ErrorRpc(
            "odoo.exceptions.UserError",
            "You can not cancel a sales order with delivered products.",
          );
        }
        for (const orden of tabla(modelo).filter((r) => ids.includes(r.id))) orden.state = "cancel";
        for (const p of entregas) {
          p.state = "cancel";
          for (const m of tabla("stock.move").filter((x) => valorDe(x, "picking_id") === p.id)) m.state = "cancel";
        }
        return true;
      }
      case "button_validate": {
        if (modelo !== "stock.picking") break;
        if (modo === "caido") {
          throw new ErrorRpc("odoo.exceptions.UserError", "Odoo falso: caído a propósito.");
        }
        const ids = args[0] as number[];
        const contexto = (kwargs.context ?? {}) as Record<string, unknown>;
        for (const p of tabla(modelo).filter((r) => ids.includes(r.id))) {
          const movs = tabla("stock.move").filter((m) => valorDe(m, "picking_id") === p.id && m.state !== "cancel");
          const hechos = movs.filter((m) => m.picked && Number(m.quantity) > 0);
          if (hechos.length === 0) {
            throw new ErrorRpc(
              "odoo.exceptions.UserError",
              "You cannot validate a transfer if no quantities are reserved nor done.",
            );
          }
          // Menos de lo pedido sin decir qué hacer con el resto: Odoo abre el asistente.
          const parcial = movs.some((m) => !m.picked || Number(m.quantity) < Number(m.product_uom_qty));
          if (parcial && !contexto.skip_backorder) {
            return { type: "ir.actions.act_window", res_model: "stock.backorder.confirmation" };
          }
          for (const m of movs) {
            if (!m.picked || Number(m.quantity) <= 0) {
              m.state = "cancel";
              continue;
            }
            m.state = "done";
            const producto = tabla("product.product").find((x) => x.id === valorDe(m, "product_id"));
            if (producto) {
              producto.qty_available = Number(producto.qty_available ?? 0) - Number(m.quantity);
              producto.free_qty = Number(producto.free_qty ?? 0) - Number(m.quantity);
            }
          }
          p.state = "done";
        }
        return true;
      }
    }
    throw new ErrorRpc("AttributeError", `El Odoo falso no sabe hacer ${modelo}.${metodo}`);
  }

  function rpc(params: { service: string; method: string; args: unknown[] }) {
    const { service, method, args } = params;
    if (service === "common" && method === "authenticate") {
      const [db, login, clave] = args;
      return db === BASE && login === USUARIO && clave === CLAVE ? UID : false;
    }
    if (service === "common" && method === "version") return { server_version: "17.0-falso" };
    if (service === "object" && method === "execute_kw") {
      const [db, uid, clave, modelo, metodo, a = [], kw = {}] = args as [
        string, number, string, string, string, unknown[]?, Record<string, unknown>?,
      ];
      if (db !== BASE || uid !== UID || clave !== CLAVE) {
        throw new ErrorRpc("odoo.exceptions.AccessDenied", "Access Denied");
      }
      return ejecutar(modelo, metodo, a, kw);
    }
    throw new ErrorRpc("builtins.Exception", `Servicio desconocido: ${service}.${method}`);
  }

  const estado = () => ({
    modo,
    partners: datos["res.partner"],
    productos: datos["product.product"],
    ordenes: datos["sale.order"].map((o): Registro & { lineas: Registro[]; entregas: EntregaFalsa[] } => ({
      ...o,
      lineas: datos["sale.order.line"].filter((l) => (o.order_line as number[]).includes(l.id)),
      entregas: datos["stock.picking"]
        .filter((p) => valorDe(p, "sale_id") === o.id)
        .map((p): EntregaFalsa => ({
          ...p,
          movimientos: datos["stock.move"].filter((m) => valorDe(m, "picking_id") === p.id),
        })),
    })),
    llamadas: llamadas.map(({ modelo, metodo, args, kwargs }) => ({ modelo, metodo, args, kwargs })),
  });

  const leer = (req: IncomingMessage) =>
    new Promise<string>((resolver) => {
      let cuerpo = "";
      req.on("data", (c) => (cuerpo += c));
      req.on("end", () => resolver(cuerpo));
    });

  const json = (res: ServerResponse, status: number, cuerpo: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };

  const servidor = createServer(async (req, res) => {
    const cuerpo = await leer(req);
    try {
      if (req.url === "/__estado") return json(res, 200, estado());
      if (req.url === "/__modo" && req.method === "POST") {
        modo = (JSON.parse(cuerpo || "{}").modo ?? null) as Modo;
        return json(res, 200, { modo });
      }
      if (req.url === "/__reiniciar" && req.method === "POST") {
        datos = sembrar();
        modo = null;
        llamadas = [];
        return json(res, 200, { ok: true });
      }
      if (req.url === "/jsonrpc" && req.method === "POST") {
        const peticion = JSON.parse(cuerpo) as { id: number; params: Parameters<typeof rpc>[0] };
        try {
          return json(res, 200, { jsonrpc: "2.0", id: peticion.id, result: rpc(peticion.params) });
        } catch (e) {
          const err = e instanceof ErrorRpc ? e : new ErrorRpc("builtins.Exception", String(e));
          return json(res, 200, {
            jsonrpc: "2.0",
            id: peticion.id,
            error: { code: 200, message: "Odoo Server Error", data: { name: err.tipo, message: err.message } },
          });
        }
      }
      json(res, 404, { error: "No existe" });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
  });

  await new Promise<void>((resolver) => servidor.listen(opciones.puerto ?? 0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  const puerto = typeof direccion === "object" && direccion ? direccion.port : opciones.puerto;

  return {
    url: `http://127.0.0.1:${puerto}`,
    estado,
    fijarModo: (m: Modo) => {
      modo = m;
    },
    reiniciar: () => {
      datos = sembrar();
      modo = null;
      llamadas = [];
    },
    cerrar: () => new Promise<void>((resolver) => servidor.close(() => resolver())),
  };
}

/* Corrido directamente (Playwright lo levanta así): escucha en ODOO_FALSO_PUERTO o 8069. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.ODOO_FALSO_PUERTO ?? 8069);
  const odoo = await crearOdooFalso({ puerto });
  console.log(`Odoo falso escuchando en ${odoo.url} (base ${BASE})`);
}
