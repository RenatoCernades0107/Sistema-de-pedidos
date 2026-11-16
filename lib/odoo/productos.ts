/**
 * Productos de Odoo (`product.product`): las variantes que se pueden vender.
 */

import type { Lote } from "./clientes";
import { camposExistentes, ejecutar, ErrorOdoo, idDe, nombreDe, terminosOdoo, texto, valoresAlmacenable } from "./rpc";
import type { ProductoOdoo } from "./tipos";

const MODELO = "product.product";

const CAMPOS = [
  "display_name",
  "name",
  "default_code",
  "barcode",
  "lst_price",
  "uom_id",
  "categ_id",
  "write_date",
  "active",
  "sale_ok",
];

type Fila = Record<string, unknown>;

/**
 * Odoo antepone la referencia al nombre (`[AC-003] ACRILICO …`). El código ya va
 * en su propio campo y la pantalla lo pinta aparte, así que aquí se quita.
 * `display_name` se prefiere a `name` porque trae los atributos de la variante
 * ("… (Bronce, 3mm)"), que es justo lo que distingue a dos variantes.
 */
export function nombreSinCodigo(nombre: string, codigo: string | null): string {
  const sinCorchetes = nombre.replace(/^\[[^\]]*\]\s*/, "");
  if (codigo && sinCorchetes.startsWith(`${codigo} `)) return sinCorchetes.slice(codigo.length + 1);
  return sinCorchetes;
}

export function deProducto(f: Fila): ProductoOdoo {
  const codigo = texto(f.default_code);
  return {
    id: f.id as number,
    nombre: nombreSinCodigo(texto(f.display_name) ?? texto(f.name) ?? "(sin nombre)", codigo),
    codigo,
    barcode: texto(f.barcode),
    precio: typeof f.lst_price === "number" ? f.lst_price : 0,
    unidad: nombreDe(f.uom_id),
    categoria: nombreDe(f.categ_id),
  };
}

const campos = () => camposExistentes(MODELO, CAMPOS);

const PAGINA = 2000;

/**
 * Todo lo vendible, o solo lo tocado desde `desde`.
 *
 * El precio vive en la plantilla (`product.template`): cambiarlo no toca el
 * `write_date` de la variante. Por eso la actualización mira también el de la
 * plantilla; si no, un cambio de precio no llegaría hasta la recarga completa.
 * Igual que con los clientes, incluye archivados y no vendibles para poder
 * sacarlos del buscador.
 */
export async function cargarProductos(desde?: string | null): Promise<Lote<ProductoOdoo>> {
  const fields = await campos();
  const dominio = desde
    ? [
        ["active", "in", [true, false]],
        "|",
        ["write_date", ">=", desde],
        ["product_tmpl_id.write_date", ">=", desde],
      ]
    : [["sale_ok", "=", true]];

  const items: ProductoOdoo[] = [];
  const retirados: number[] = [];
  let ultimaEscritura: string | null = desde ?? null;

  for (let offset = 0; ; offset += PAGINA) {
    const filas = await ejecutar<Fila[]>(MODELO, "search_read", [dominio], {
      fields,
      order: "id",
      offset,
      limit: PAGINA,
    });
    for (const f of filas) {
      if (f.active === false || f.sale_ok === false) retirados.push(f.id as number);
      else items.push(deProducto(f));
      const w = texto(f.write_date);
      if (w && (!ultimaEscritura || w > ultimaEscritura)) ultimaEscritura = w;
    }
    if (filas.length < PAGINA) break;
  }

  return { items, retirados, ultimaEscritura };
}

/**
 * Respaldo en vivo: cada palabra en el nombre, la referencia o el código de
 * barras. Un código de barras se compara exacto aparte, porque un lector lo
 * manda entero y de un tirón.
 */
export async function buscarProductosEnOdoo(q: string, limite = 20): Promise<ProductoOdoo[]> {
  const fields = await campos();
  const terminos = terminosOdoo(q);
  if (terminos.length === 0) return [];

  // Notación polaca de Odoo. "Todas las palabras" son n-1 '&' seguidos de una
  // expresión por palabra; cada una, "en el nombre, la referencia o el barcode".
  const todasLasPalabras: unknown[] = Array.from({ length: terminos.length - 1 }, () => "&");
  for (const t of terminos) {
    todasLasPalabras.push(
      "|",
      "|",
      ["name", "ilike", t],
      ["default_code", "ilike", t],
      ["barcode", "ilike", t],
    );
  }

  const entero = q.trim();
  const dominio = [
    ["sale_ok", "=", true],
    "|",
    "|",
    ["default_code", "=ilike", entero],
    ["barcode", "=", entero],
    ...todasLasPalabras,
  ];

  const filas = await ejecutar<Fila[]>(MODELO, "search_read", [dominio], { fields, limit: limite });
  return filas.map(deProducto);
}

/** Los productos por id, para cuando el índice todavía no los tiene. */
export async function leerProductos(ids: number[]): Promise<ProductoOdoo[]> {
  if (ids.length === 0) return [];
  const filas = await ejecutar<Fila[]>(MODELO, "read", [ids], { fields: await campos() });
  return filas.map(deProducto);
}

/**
 * Los productos por su referencia interna. Una sola consulta para todos: es lo
 * que usa el cálculo de cortes para saber el precio de cada formato de plancha.
 */
export async function leerProductosPorCodigo(codigos: string[]): Promise<ProductoOdoo[]> {
  if (codigos.length === 0) return [];
  const filas = await ejecutar<Fila[]>(MODELO, "search_read", [[["default_code", "in", codigos]]], {
    fields: await campos(),
  });
  return filas.map(deProducto);
}

/**
 * Cuánto hay de cada producto, por su referencia interna. Una sola consulta
 * para todos los códigos.
 *
 * `free_qty` es lo que hay menos lo que ya está reservado para otros pedidos: lo
 * que de verdad se puede prometer. Si este Odoo no lo tiene, vale lo que hay en
 * mano; si no tiene Inventario, `null` ("no se sabe"), que no es lo mismo que 0.
 */
export async function stockPorCodigo(codigos: string[]): Promise<Map<string, number | null>> {
  const mapa = new Map<string, number | null>();
  if (codigos.length === 0) return mapa;

  const deStock = await camposExistentes(MODELO, ["free_qty", "qty_available"]);
  const filas = await ejecutar<Fila[]>(MODELO, "search_read", [[["default_code", "in", codigos]]], {
    fields: ["default_code", ...deStock],
  });
  for (const f of filas) {
    const codigo = texto(f.default_code);
    if (!codigo) continue;
    const disponible = deStock.includes("free_qty") ? f.free_qty : f.qty_available;
    const cantidad = typeof disponible === "number" ? disponible : null;
    // Dos productos con el mismo código: su stock se suma.
    const previo = mapa.get(codigo);
    mapa.set(codigo, cantidad === null ? (previo ?? null) : (previo ?? 0) + cantidad);
  }
  return mapa;
}

/* ── Crear productos y cambiar su precio ──────────────────────────────────── */

/**
 * El siguiente código libre con ese prefijo, siguiendo el correlativo que ya
 * tiene Odoo: tras ACC054 viene ACC055, tras PEG019 viene PEG020. El ancho del
 * número es el más largo que ya se usa (o `ancho`, si no hay ninguno).
 */
export function siguienteDe(prefijo: string, existentes: string[], ancho = 3): string {
  const patron = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let mayor = 0;
  let digitos = ancho;
  for (const c of existentes) {
    const m = patron.exec(c);
    if (!m) continue;
    mayor = Math.max(mayor, Number(m[1]));
    digitos = Math.max(digitos, m[1].length);
  }
  return `${prefijo}${String(mayor + 1).padStart(digitos, "0")}`;
}

/** Los códigos con ese prefijo que hay en Odoo, archivados incluidos. */
export async function codigosConPrefijo(prefijo: string): Promise<string[]> {
  const filas = await ejecutar<Fila[]>(
    MODELO,
    "search_read",
    [[["default_code", "=like", `${prefijo}%`], ["active", "in", [true, false]]]],
    { fields: ["default_code"] },
  );
  return filas.map((f) => texto(f.default_code)).filter((c): c is string => !!c);
}

export interface ProductoNuevo {
  nombre: string;
  codigo: string;
  /** Precio de venta. */
  precio: number;
}

/**
 * Crea un producto almacenable y vendible, en unidades. Si ya hay uno con ese
 * código, lo devuelve: un reintento no duplica.
 */
export async function crearProductoAlmacenable(p: ProductoNuevo): Promise<ProductoOdoo> {
  const buscar = async () =>
    ejecutar<Fila[]>(MODELO, "search_read", [[["default_code", "=", p.codigo]]], { fields: await campos(), limit: 1 });
  const [previo] = await buscar();
  if (previo) return deProducto(previo);
  await ejecutar("product.template", "create", [
    {
      name: p.nombre.trim().toUpperCase(),
      default_code: p.codigo,
      list_price: p.precio,
      sale_ok: true,
      purchase_ok: true,
      ...(await valoresAlmacenable()),
    },
  ]);
  const [creado] = await buscar();
  if (!creado) throw new ErrorOdoo(`Odoo creó el producto ${p.codigo} pero no lo devolvió.`);
  return deProducto(creado);
}

/** Cambia el precio de venta de un producto (vive en su plantilla). Devuelve el producto al día. */
export async function cambiarPrecio(productoId: number, precio: number): Promise<ProductoOdoo> {
  const [f] = await ejecutar<Fila[]>(MODELO, "read", [[productoId]], { fields: ["product_tmpl_id"] });
  if (!f) throw new ErrorOdoo("Ese producto ya no existe en Odoo.");
  const plantilla = idDe(f.product_tmpl_id) ?? productoId;
  await ejecutar("product.template", "write", [[plantilla], { list_price: precio }]);
  const [leido] = await leerProductos([productoId]);
  if (!leido) throw new ErrorOdoo("Odoo cambió el precio pero no devolvió el producto.");
  return leido;
}

/** El costo de cada producto (`standard_price`), por id. */
export async function costosPorId(ids: number[]): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  if (ids.length === 0) return mapa;
  if ((await camposExistentes(MODELO, ["standard_price"])).length === 0) return mapa;
  const filas = await ejecutar<Fila[]>(MODELO, "read", [[...new Set(ids)]], { fields: ["standard_price"] });
  for (const f of filas) {
    if (typeof f.standard_price === "number") mapa.set(f.id as number, f.standard_price);
  }
  return mapa;
}
