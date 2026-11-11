/**
 * Guardar una cotización nueva: lo que comparten `crearCotizacion` y
 * `registrarPedido`, porque detrás de cada pedido hay una cotización.
 *
 * Aquí solo se guarda en la base. Ir a Odoo es el paso siguiente
 * (`sincronizarConOdoo`), y lo da quien llama: primero se guarda y después se va
 * a Odoo, para que un Odoo caído no le haga perder a nadie lo tecleado.
 */

import { prepararCorte } from "./cortes-servidor";
import { mensajeDeError } from "./errores";
import type { NuevaCotizacion } from "./esquemas";
import { productosPorId } from "./odoo/catalogos";
import { leerCliente } from "./odoo/clientes";
import { ErrorOdoo } from "./odoo/rpc";
import type { ClienteOdoo } from "./odoo/tipos";
import { clienteServidor } from "./supabase-servidor";
import type { Json } from "./supabase-tipos";

export const mensajeOdoo = (e: unknown) =>
  e instanceof ErrorOdoo ? e.message : "No se pudo hablar con Odoo. Intenta de nuevo.";

export type CotizacionRegistrada =
  | { ok: true; id: string; cliente: ClienteOdoo }
  | { ok: false; error: string };

/**
 * Del navegador llegan referencias: ids de Odoo, cantidades, precios y, de un
 * corte, el material y las piezas. El nombre del cliente y de cada producto, y
 * todo el cálculo de cada corte, se vuelven a leer o a hacer aquí.
 */
export async function registrarCotizacion(v: NuevaCotizacion): Promise<CotizacionRegistrada> {
  const fallo = (error: string) => ({ ok: false as const, error });

  const deProducto = v.lineas.filter((l) => l.tipo !== "corte");
  let cliente: ClienteOdoo | null;
  let productos: Awaited<ReturnType<typeof productosPorId>>;
  try {
    [cliente, productos] = await Promise.all([
      leerCliente(v.clienteId),
      productosPorId(deProducto.map((l) => l.productoId)),
    ]);
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }
  if (!cliente) return fallo("Ese cliente ya no existe en Odoo. Búscalo de nuevo.");

  const lineas = [];
  for (const l of v.lineas) {
    if (l.tipo === "corte") {
      // El corte se calcula aquí otra vez: su precio no llega del navegador.
      let corte: Awaited<ReturnType<typeof prepararCorte>>;
      try {
        corte = await prepararCorte(l);
      } catch (e) {
        return fallo(mensajeOdoo(e));
      }
      if (!corte.ok) return fallo(corte.error);
      lineas.push(corte.fila);
      continue;
    }
    const p = productos.get(l.productoId);
    if (!p) return fallo("Uno de los productos ya no existe en Odoo. Quítalo y vuelve a buscarlo.");
    lineas.push({
      tipo: "producto" as const,
      odoo_product_id: p.id,
      producto_nombre: p.nombre,
      producto_codigo: p.codigo,
      descripcion: l.descripcion || null,
      cantidad: l.cantidad,
      precio_unitario: l.precioUnitario,
    });
  }

  const supabase = await clienteServidor();
  const { data: id, error } = await supabase.rpc("crear_cotizacion", {
    p_canal: v.canal,
    p_odoo_partner_id: cliente.id,
    p_cliente_nombre: cliente.nombre,
    p_cliente_documento: cliente.documento ?? undefined,
    p_cliente_telefono: cliente.telefono ?? undefined,
    p_lineas: lineas as unknown as Json,
    p_notas: v.notas ?? undefined,
  });
  if (error || !id) return fallo(mensajeDeError(error));

  return { ok: true, id, cliente };
}
