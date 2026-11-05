/**
 * Clientes de Odoo (`res.partner`): leerlos, buscarlos en vivo y crearlos.
 */

import { soloDigitos, tipoDeDocumento } from "../busqueda-inteligente";
import {
  camposExistentes,
  ejecutar,
  ErrorOdoo,
  modeloExiste,
  nombreDe,
  registrarReinicio,
  terminosOdoo,
  texto,
} from "./rpc";
import type { ClienteOdoo } from "./tipos";

const MODELO = "res.partner";

/** `mobile` no existe en todas las versiones: se pide solo si está. */
const CAMPOS = [
  "name",
  "vat",
  "phone",
  "mobile",
  "email",
  "city",
  "is_company",
  "parent_id",
  "write_date",
  "active",
];

type Fila = Record<string, unknown>;

export function deCliente(f: Fila): ClienteOdoo {
  return {
    id: f.id as number,
    nombre: texto(f.name) ?? "(sin nombre)",
    documento: texto(f.vat),
    telefono: texto(f.phone) ?? texto(f.mobile),
    email: texto(f.email),
    ciudad: texto(f.city),
    esEmpresa: f.is_company === true,
    empresa: nombreDe(f.parent_id),
  };
}

const campos = () => camposExistentes(MODELO, CAMPOS);

/** Lo que entrega una fuente del índice: lo vigente, lo que salió y hasta cuándo. */
export interface Lote<T> {
  items: T[];
  /** Ids que ya no deben ofrecerse (archivados). */
  retirados: number[];
  /** El `write_date` más reciente visto: desde ahí pide la siguiente actualización. */
  ultimaEscritura: string | null;
}

const PAGINA = 2000;

/**
 * Todos los contactos activos, o solo los tocados desde `desde`. Por páginas: en
 * un Odoo con años de clientes, una sola respuesta puede pesar megas.
 *
 * La actualización incluye los archivados a propósito: es la única forma de
 * enterarse de que alguien archivó un contacto y sacarlo del buscador.
 */
export async function cargarClientes(desde?: string | null): Promise<Lote<ClienteOdoo>> {
  const fields = await campos();
  const dominio = desde
    ? [
        ["write_date", ">=", desde],
        ["active", "in", [true, false]],
      ]
    : [];

  const items: ClienteOdoo[] = [];
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
      if (f.active === false) retirados.push(f.id as number);
      else items.push(deCliente(f));
      const w = texto(f.write_date);
      if (w && (!ultimaEscritura || w > ultimaEscritura)) ultimaEscritura = w;
    }
    if (filas.length < PAGINA) break;
  }

  return { items, retirados, ultimaEscritura };
}

/**
 * Búsqueda directa en Odoo, para cuando el índice no encuentra nada: un cliente
 * que crearon en Odoo hace un minuto todavía no está en él.
 *
 * Cada palabra tiene que aparecer en el nombre, el documento, el teléfono o el
 * correo. Odoo compara con `ilike`, que no perdona tildes ni errores; por eso esto
 * es el respaldo y no el camino principal.
 */
export async function buscarClientesEnOdoo(q: string, limite = 20): Promise<ClienteOdoo[]> {
  const fields = await campos();
  const terminos = terminosOdoo(q);
  if (terminos.length === 0) return [];

  const columnas = ["name", "vat", "phone", "email", ...(fields.includes("mobile") ? ["mobile"] : [])];
  const dominio: unknown[] = [];
  for (const t of terminos) {
    // Notación polaca de Odoo: n columnas necesitan n-1 '|' delante.
    for (let i = 1; i < columnas.length; i++) dominio.push("|");
    for (const c of columnas) dominio.push([c, "ilike", t]);
  }

  const filas = await ejecutar<Fila[]>(MODELO, "search_read", [dominio], { fields, limit: limite });
  return filas.map(deCliente);
}

export async function leerCliente(id: number): Promise<ClienteOdoo | null> {
  const filas = await ejecutar<Fila[]>(MODELO, "read", [[id]], { fields: await campos() });
  return filas[0] ? deCliente(filas[0]) : null;
}

/** El cliente que ya tiene ese RUC/DNI, si hay. Con y sin el prefijo de país. */
export async function buscarPorDocumento(documento: string): Promise<ClienteOdoo | null> {
  const d = soloDigitos(documento);
  if (!d) return null;
  const filas = await ejecutar<Fila[]>(
    MODELO,
    "search_read",
    [[["vat", "in", [d, `PE${d}`]]]],
    { fields: await campos(), limit: 1 },
  );
  return filas[0] ? deCliente(filas[0]) : null;
}

/* ── Alta ──────────────────────────────────────────────────────────────────── */

let peru: Promise<number | null> | null = null;
registrarReinicio(() => (peru = null));

function idPeru(): Promise<number | null> {
  peru ??= ejecutar<number[]>("res.country", "search", [[["code", "=", "PE"]]], { limit: 1 }).then(
    (ids) => ids[0] ?? null,
  );
  peru.catch(() => (peru = null));
  return peru;
}

const MODELO_TIPO_DOC = "l10n_latam.identification.type";

/**
 * El tipo de documento de la localización latinoamericana, si está instalada.
 * Con ella, Odoo valida el `vat` según el tipo: un DNI cargado como RUC no pasa.
 * Se busca por el código de la SUNAT (`l10n_pe_vat_code`: 6 RUC, 1 DNI) y, si
 * ese campo no existe, por el nombre.
 */
async function tipoDocumentoOdoo(tipo: "RUC" | "DNI"): Promise<number | null> {
  if (!(await modeloExiste(MODELO_TIPO_DOC))) return null;

  const fields = await camposExistentes(MODELO_TIPO_DOC, ["name", "l10n_pe_vat_code"]);
  const filas = await ejecutar<Fila[]>(MODELO_TIPO_DOC, "search_read", [[]], { fields });

  const codigo = tipo === "RUC" ? "6" : "1";
  const porCodigo = filas.find((f) => texto(f.l10n_pe_vat_code) === codigo);
  if (porCodigo) return porCodigo.id as number;

  const porNombre = filas.find((f) => (texto(f.name) ?? "").toUpperCase().includes(tipo));
  return porNombre ? (porNombre.id as number) : null;
}

export interface DatosClienteNuevo {
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
}

/**
 * Crea el cliente en Odoo. Si ya hay uno con ese RUC/DNI no crea otro: devuelve
 * el existente y lo dice (`existia`), para que la pantalla lo seleccione y avise.
 */
export async function crearCliente(
  datos: DatosClienteNuevo,
): Promise<{ cliente: ClienteOdoo; existia: boolean }> {
  const tipo = datos.documento ? tipoDeDocumento(datos.documento) : null;

  if (datos.documento) {
    const existente = await buscarPorDocumento(datos.documento);
    if (existente) return { cliente: existente, existia: true };
  }

  const [pais, tipoDoc] = await Promise.all([idPeru(), tipo ? tipoDocumentoOdoo(tipo) : null]);

  const valores: Record<string, unknown> = {
    name: datos.nombre.trim(),
    // RUC 20: persona jurídica. Un RUC 10 es una persona con negocio.
    is_company: tipo === "RUC" && datos.documento!.startsWith("20"),
  };
  if (datos.documento) valores.vat = datos.documento;
  if (datos.telefono) valores.phone = datos.telefono;
  if (datos.email) valores.email = datos.email;
  if (pais) valores.country_id = pais;
  if (tipoDoc) valores.l10n_latam_identification_type_id = tipoDoc;

  const id = await ejecutar<number>(MODELO, "create", [valores]);
  const cliente = await leerCliente(id);
  if (!cliente) throw new ErrorOdoo("Odoo creó el cliente pero no lo devolvió. Búscalo de nuevo.");
  return { cliente, existia: false };
}
