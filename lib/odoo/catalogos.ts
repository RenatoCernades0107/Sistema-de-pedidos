/**
 * Los dos índices de la app —clientes y productos— y cómo se busca en cada uno.
 * Una sola instancia por proceso del servidor.
 */

import { compactar, type CamposBuscables } from "../busqueda-inteligente";
import { buscarClientesEnOdoo, cargarClientes } from "./clientes";
import { IndiceOdoo } from "./indice";
import { buscarProductosEnOdoo, cargarProductos, leerProductos } from "./productos";
import { registrarReinicio } from "./rpc";
import type { ClienteOdoo, ProductoOdoo, RespuestaBusqueda } from "./tipos";

export const camposCliente = (c: ClienteOdoo): CamposBuscables => ({
  nombre: c.nombre,
  codigos: [c.documento],
  extra: [c.empresa, c.email, c.ciudad],
  telefonos: [c.telefono],
});

export const camposProducto = (p: ProductoOdoo): CamposBuscables => ({
  nombre: p.nombre,
  codigos: [p.codigo, p.barcode],
  extra: [p.categoria],
});

let clientes = new IndiceOdoo(cargarClientes, camposCliente);
let productos = new IndiceOdoo(cargarProductos, camposProducto);

registrarReinicio(() => {
  clientes = new IndiceOdoo(cargarClientes, camposCliente);
  productos = new IndiceOdoo(cargarProductos, camposProducto);
});

export const indiceClientes = () => clientes;
export const indiceProductos = () => productos;

/** Al abrir el formulario: que la primera tecla no espere la carga entera. */
export function calentarCatalogos() {
  clientes.calentar();
  productos.calentar();
}

const LIMITE = 12;

/**
 * Ir a Odoo en vivo cuesta un viaje; con una o dos letras el índice ya dijo todo
 * lo que se puede decir.
 */
const vale = (q: string) => compactar(q).length >= 3;

export async function buscarClientes(
  q: string,
  popularidad: (id: number) => number = () => 0,
): Promise<RespuestaBusqueda<ClienteOdoo>> {
  const buscador = await clientes.buscadorActual();
  const encontrados = buscador.buscar(q, { limite: LIMITE, popularidad: (c) => popularidad(c.id) });
  if (encontrados.length > 0) {
    return {
      origen: "indice",
      resultados: encontrados.map((e) => ({ item: e.item, porCodigo: e.porCodigo })),
    };
  }

  if (!vale(q)) return { origen: "indice", resultados: [] };
  const enVivo = await buscarClientesEnOdoo(q, LIMITE);
  for (const c of enVivo) clientes.agregar(c);
  return { origen: "odoo", resultados: enVivo.map((item) => ({ item, porCodigo: null })) };
}

export async function buscarProductos(
  q: string,
  opciones: { popularidad?: (id: number) => number; soloCodigoExacto?: boolean } = {},
): Promise<RespuestaBusqueda<ProductoOdoo>> {
  const { popularidad = () => 0, soloCodigoExacto = false } = opciones;
  const buscador = await productos.buscadorActual();
  const encontrados = buscador.buscar(q, {
    limite: LIMITE,
    popularidad: (p) => popularidad(p.id),
    soloCodigoExacto,
  });
  if (encontrados.length > 0 || soloCodigoExacto) {
    return {
      origen: "indice",
      resultados: encontrados.map((e) => ({ item: e.item, porCodigo: e.porCodigo })),
    };
  }

  if (!vale(q)) return { origen: "indice", resultados: [] };
  const enVivo = await buscarProductosEnOdoo(q, LIMITE);
  for (const p of enVivo) productos.agregar(p);
  return { origen: "odoo", resultados: enVivo.map((item) => ({ item, porCodigo: null })) };
}

/**
 * Los productos por id, del índice si están y de Odoo si no. Es lo que usa el
 * servidor para no fiarse del nombre que mande el navegador.
 */
export async function productosPorId(ids: number[]): Promise<Map<number, ProductoOdoo>> {
  await productos.asegurar().catch(() => {});
  const mapa = new Map<number, ProductoOdoo>();
  const faltan: number[] = [];
  for (const id of new Set(ids)) {
    const p = productos.obtener(id);
    if (p) mapa.set(id, p);
    else faltan.push(id);
  }
  for (const p of await leerProductos(faltan)) {
    mapa.set(p.id, p);
    productos.agregar(p);
  }
  return mapa;
}
