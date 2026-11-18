/**
 * El kárdex del lado del servidor: los movimientos hechos de un producto (o del
 * lote de un sobrante) en los almacenes de la app, con nombre y saldo.
 */

import { cargarAlmacenes, odooDeAlmacen } from "./almacenes-servidor";
import { filasDeKardex, type FilaKardex, type Referencias } from "./kardex";
import { movimientosDeProducto, stockPorAlmacen, type UbicacionDeAlmacen } from "./odoo/almacenes";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { clienteServidor } from "./supabase-servidor";

export type ResultadoKardex = { ok: true; filas: FilaKardex[]; hoy: Record<string, number> } | { ok: false; error: string };

const CODIGO_APP = /App Plexiacril ((ING|TRF|CAS)-\d+)/;
const COTIZACION = /App Plexiacril ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Lo que la base sabe de los orígenes de unos movimientos. Lo que el rol no puede leer queda sin nombre. */
async function referencias(origenes: string[], origenesProduccion: string[]): Promise<Referencias> {
  const supabase = await clienteServidor();
  const codigos = [...new Set(origenes.flatMap((o) => o.match(CODIGO_APP)?.[1] ?? []))];
  const ingresos = codigos.filter((c) => c.startsWith("ING-"));
  const casos = codigos.filter((c) => c.startsWith("CAS-"));
  const ventas = [...new Set(origenes.filter((o) => !CODIGO_APP.test(o)))];
  const cotizaciones = [...new Set(origenesProduccion.flatMap((o) => o.match(COTIZACION)?.[1] ?? []))];

  const [i, c, v, p] = await Promise.all([
    ingresos.length ? supabase.from("ingresos_stock").select("codigo, tipo").in("codigo", ingresos) : { data: [] },
    casos.length ? supabase.from("casos_stock").select("codigo, tipo").in("codigo", casos) : { data: [] },
    ventas.length
      ? supabase.from("cotizaciones").select("odoo_order_name, pedidos(codigo)").in("odoo_order_name", ventas)
      : { data: [] },
    cotizaciones.length ? supabase.from("cotizaciones").select("id, pedidos(codigo)").in("id", cotizaciones) : { data: [] },
  ]);
  const codigoPedido = (x: unknown) => {
    const pedidos = x as { codigo: string } | { codigo: string }[] | null;
    return (Array.isArray(pedidos) ? pedidos[0] : pedidos)?.codigo ?? null;
  };
  return {
    ingresos: new Map((i.data ?? []).map((x) => [x.codigo, x.tipo as "compra" | "ajuste"])),
    casos: new Map((c.data ?? []).map((x) => [x.codigo, x.tipo as "baja" | "diferencia"])),
    pedidoDeVenta: new Map(
      (v.data ?? []).flatMap((x) => {
        const pedido = codigoPedido(x.pedidos);
        return x.odoo_order_name && pedido ? [[x.odoo_order_name, pedido] as const] : [];
      }),
    ),
    pedidoDeCotizacion: new Map(
      (p.data ?? []).flatMap((x) => {
        const pedido = codigoPedido(x.pedidos);
        return pedido ? [[x.id, pedido] as const] : [];
      }),
    ),
  };
}

/**
 * El kárdex de un producto en los almacenes de la app (o en uno), desde hace
 * `dias`. Con `sobrante`, el de su lote: su saldo es 1 donde está ahora.
 */
export async function cargarKardex(f: {
  productoId: number;
  almacenId: string | null;
  dias: number;
  sobrante?: { loteId: number; almacenId: string; vigente: boolean } | null;
}): Promise<ResultadoKardex> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  try {
    const almacenes = (await cargarAlmacenes()).filter((a) => a.activo && (!f.almacenId || a.id === f.almacenId));
    const ubicaciones: UbicacionDeAlmacen[] = [];
    for (const a of almacenes) ubicaciones.push({ almacenId: a.id, ubicacionId: (await odooDeAlmacen(a)).ubicacionId });
    const almacenDeUbicacion = new Map(ubicaciones.map((u) => [u.ubicacionId, u.almacenId]));

    const desde = new Date(Date.now() - f.dias * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
    const movs = await movimientosDeProducto({
      productoId: f.productoId,
      ubicaciones: ubicaciones.map((u) => u.ubicacionId),
      desde,
      loteId: f.sobrante?.loteId ?? null,
    });

    let hoy: Record<string, number>;
    if (f.sobrante) {
      hoy = Object.fromEntries(almacenes.map((a) => [a.id, f.sobrante!.vigente && a.id === f.sobrante!.almacenId ? 1 : 0]));
    } else {
      const stock = (await stockPorAlmacen([f.productoId], ubicaciones)).get(f.productoId);
      hoy = Object.fromEntries(almacenes.map((a) => [a.id, stock?.porAlmacen[a.id] ?? 0]));
    }

    const refs = await referencias(
      movs.flatMap((m) => (m.origen ? [m.origen] : [])),
      movs.flatMap((m) => (m.origenProduccion ? [m.origenProduccion] : [])),
    );
    return { ok: true, filas: filasDeKardex(movs, almacenDeUbicacion, hoy, refs), hoy };
  } catch (e) {
    if (e instanceof ErrorOdoo) return { ok: false, error: e.message };
    console.error("[kardex]", e);
    return { ok: false, error: "Algo falló al leer el kárdex de Odoo." };
  }
}
