/**
 * El cliente de Odoo de la app, de verdad, contra el Odoo falso de las pruebas
 * e2e corriendo en este mismo proceso. Lo que aquí pasa es lo que pasará contra
 * el Odoo de la empresa, salvo por lo que el falso simplifica (impuestos fijos
 * del 18 %, sin listas de precios).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { buscarClientes, buscarProductos, productosPorId } from "./catalogos";
import { buscarClientesEnOdoo, cargarClientes, crearCliente } from "./clientes";
import { crearPedidoDeVenta, leerPedidoDeVenta, lineasDeVenta, origenDe } from "./pedidos-venta";
import { buscarProductosEnOdoo, cargarProductos, nombreSinCodigo } from "./productos";
import { reiniciarCacheOdoo } from "./rpc";

let odoo: Awaited<ReturnType<typeof crearOdooFalso>>;

beforeAll(async () => {
  odoo = await crearOdooFalso();
  vi.stubEnv("ODOO_URL", odoo.url);
  vi.stubEnv("ODOO_DB", BASE);
  vi.stubEnv("ODOO_USUARIO", USUARIO);
  vi.stubEnv("ODOO_API_KEY", CLAVE);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await odoo.cerrar();
});

beforeEach(() => {
  odoo.reiniciar();
  reiniciarCacheOdoo();
});

const linea = (productoId: number, cantidad: number, precioUnitario: number, descripcion: string | null = null) => ({
  productoId,
  nombreProducto: "ACRILICO F8 CRISTAL 3MM",
  codigo: "AC-003",
  cantidad,
  precioUnitario,
  descripcion,
});

describe("catálogos", () => {
  it("carga clientes activos sin pedir `mobile`, que este Odoo no tiene", async () => {
    const lote = await cargarClientes();
    expect(lote.items.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(lote.items[0]).toMatchObject({ nombre: "E2E José Pérez Quispe", documento: "45678912", telefono: "987 654 321" });
    const pedidos = odoo.estado().llamadas.filter((l) => l.metodo === "search_read" && l.modelo === "res.partner");
    expect(pedidos[0].kwargs.fields).not.toContain("mobile");
  });

  it("la actualización trae los archivados para poder sacarlos", async () => {
    const lote = await cargarClientes("2026-01-01 00:00:00");
    expect(lote.retirados).toEqual([4]);
  });

  it("carga solo productos vendibles, con el código fuera del nombre", async () => {
    const lote = await cargarProductos();
    expect(lote.items.map((p) => p.id)).not.toContain(16);
    expect(lote.items.find((p) => p.id === 10)).toMatchObject({
      nombre: "ACRILICO F8 CRISTAL 3MM",
      codigo: "AC-003",
      barcode: "7750000000031",
      precio: 120,
      unidad: "Unidades",
    });
    expect(nombreSinCodigo("[AC-003] ACRILICO", "AC-003")).toBe("ACRILICO");
  });

  it("busca en el índice por código y por nombre con errores", async () => {
    expect((await buscarProductos("ac 003")).resultados[0]).toMatchObject({ item: { id: 10 }, porCodigo: "exacto" });
    expect((await buscarProductos("acrlico bronce")).resultados[0].item.id).toBe(12);
    expect((await buscarClientes("jose")).resultados[0].item.id).toBe(1);
    expect((await buscarClientes("20123456786")).origen).toBe("indice");
  });

  it("si el índice no tiene nada, pregunta a Odoo en vivo (y lo recuerda)", async () => {
    await buscarClientes("andina"); // carga el índice
    await crearClienteDirecto("E2E Recién Creado En Odoo");
    // Odoo compara con tildes: en vivo se busca tal como se escribió.
    const r = await buscarClientes("Recién creado");
    expect(r.origen).toBe("odoo");
    expect(r.resultados[0].item.nombre).toBe("E2E Recién Creado En Odoo");
    // Desde ahí lo tiene el índice, que sí perdona la tilde.
    expect((await buscarClientes("recien creado")).origen).toBe("indice");
  });

  it("la búsqueda en vivo arma bien los dominios de Odoo", async () => {
    expect((await buscarClientesEnOdoo("andina compras")).map((c) => c.id)).toEqual([2]);
    expect((await buscarProductosEnOdoo("7750000000031")).map((p) => p.id)).toEqual([10]);
    expect((await buscarProductosEnOdoo("ac-00")).map((p) => p.id)).toEqual([10, 11]);
    expect((await buscarProductosEnOdoo("cristal 5mm")).map((p) => p.id)).toEqual([11]);
  });

  it("productosPorId completa desde Odoo lo que el índice no tiene", async () => {
    const mapa = await productosPorId([10, 16]);
    expect(mapa.get(10)?.codigo).toBe("AC-003");
    // El 16 no es vendible, así que no está en el índice, pero se lee por id.
    expect(mapa.get(16)?.codigo).toBe("NO-VENTA");
  });
});

/** Un cliente creado "por fuera", directamente en el Odoo falso. */
async function crearClienteDirecto(nombre: string) {
  await fetch(`${odoo.url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      params: { service: "object", method: "execute_kw", args: [BASE, 7, CLAVE, "res.partner", "create", [{ name: nombre }], {}] },
    }),
  });
}

describe("crear clientes", () => {
  it("con RUC: tipo de documento RUC, país Perú y empresa", async () => {
    const r = await crearCliente({ nombre: "E2E Nueva Empresa SAC", documento: "20512345671", telefono: "999888777", email: null });
    expect(r.existia).toBe(false);
    expect(r.cliente).toMatchObject({ nombre: "E2E Nueva Empresa SAC", documento: "20512345671" });
    const creado = odoo.estado().partners.find((p) => p.id === r.cliente.id)!;
    expect(creado).toMatchObject({ is_company: true, country_id: 173, l10n_latam_identification_type_id: 4 });
  });

  it("con DNI: tipo DNI y persona", async () => {
    const r = await crearCliente({ nombre: "E2E Ana Torres", documento: "12345678", telefono: null, email: null });
    const creado = odoo.estado().partners.find((p) => p.id === r.cliente.id)!;
    expect(creado).toMatchObject({ is_company: false, l10n_latam_identification_type_id: 5 });
  });

  it("si el documento ya existe no duplica: devuelve el que había", async () => {
    const antes = odoo.estado().partners.length;
    const r = await crearCliente({ nombre: "Otro nombre", documento: "20123456786", telefono: null, email: null });
    expect(r).toMatchObject({ existia: true, cliente: { id: 2 } });
    expect(odoo.estado().partners).toHaveLength(antes);
  });

  it("sin documento también se puede", async () => {
    const r = await crearCliente({ nombre: "E2E Sin Documento", documento: null, telefono: null, email: null });
    expect(r.cliente.documento).toBeNull();
  });
});

describe("cotizaciones en Odoo", () => {
  it("crea la sale.order con sus líneas, precios y la marca de origen, y devuelve los montos", async () => {
    const r = await crearPedidoDeVenta({
      cotizacionId: "11111111-2222-3333-4444-555555555555",
      clienteId: 2,
      lineas: [linea(10, 2.5, 100, "corte 30x50"), { ...linea(14, 30, 1.5), codigo: "SRV-CL", nombreProducto: "SERVICIO CORTE LASER" }],
    });
    expect(r).toMatchObject({ orderName: "S00001", montoSinImpuestos: 295, montoImpuestos: 53.1, montoTotal: 348.1, yaExistia: false });

    const [orden] = odoo.estado().ordenes;
    expect(orden).toMatchObject({ partner_id: [2, "E2E Corporación Andina SAC"], origin: origenDe("11111111-2222-3333-4444-555555555555") });
    expect(orden.lineas.map((l) => [l.product_id, l.product_uom_qty, l.price_unit])).toEqual([
      [[10, "[AC-003] ACRILICO F8 CRISTAL 3MM"], 2.5, 100],
      [[14, "[SRV-CL] SERVICIO CORTE LASER"], 30, 1.5],
    ]);
    // El detalle va en la descripción de la línea, debajo del producto.
    expect(orden.lineas[0].name).toBe("[AC-003] ACRILICO F8 CRISTAL 3MM\ncorte 30x50");
  });

  it("sin detalle no manda `name`: Odoo pone la descripción del producto", () => {
    expect(lineasDeVenta([linea(10, 1, 120)])).toEqual([[0, 0, { product_id: 10, product_uom_qty: 1, price_unit: 120 }]]);
  });

  it("si Odoo creó la orden pero la respuesta se perdió, reintentar no duplica", async () => {
    const datos = { cotizacionId: "aaaaaaaa-0000-0000-0000-000000000001", clienteId: 1, lineas: [linea(10, 1, 120)] };

    odoo.fijarModo("perder-respuesta");
    await expect(crearPedidoDeVenta(datos)).rejects.toThrow(/respuesta se perdió/);
    expect(odoo.estado().ordenes).toHaveLength(1);

    odoo.fijarModo(null);
    const r = await crearPedidoDeVenta(datos);
    expect(r.yaExistia).toBe(true);
    expect(r.orderName).toBe("S00001");
    expect(odoo.estado().ordenes).toHaveLength(1);
  });

  it("un Odoo que rechaza la orden da un error legible", async () => {
    odoo.fijarModo("caido");
    await expect(
      crearPedidoDeVenta({ cotizacionId: "bbbbbbbb-0000-0000-0000-000000000001", clienteId: 1, lineas: [linea(10, 1, 120)] }),
    ).rejects.toThrow("Odoo falso: caído a propósito.");
  });

  it("lee lo que creó el asistente: cliente, líneas sin las secciones y el detalle aparte del producto", async () => {
    const creada = await crearPedidoDeVenta({
      cotizacionId: "cccccccc-0000-0000-0000-000000000001",
      clienteId: 3,
      lineas: [linea(10, 5, 20, "5 piezas 30x50cm")],
    });
    const venta = await leerPedidoDeVenta(creada.orderId);
    expect(venta).toMatchObject({
      orderName: creada.orderName,
      clienteId: 3,
      montoTotal: 118,
      lineas: [{ productoId: 10, nombre: "ACRILICO F8 CRISTAL 3MM", codigo: "AC-003", cantidad: 5, precioUnitario: 20, descripcion: "5 piezas 30x50cm" }],
    });
    expect(await leerPedidoDeVenta(999)).toBeNull();
  });
});
