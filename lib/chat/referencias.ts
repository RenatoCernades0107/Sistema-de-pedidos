/**
 * La lógica del campo con referencias @, sin React ni red: se prueba sola
 * (`referencias.test.ts`) y la usan el campo, el texto y el servidor.
 *
 * El mensaje se guarda con fichas `@r1`, `@r2`… (ver `tipos.ts`), pero escribir
 * mirando `@r1` no le dice nada a nadie. Así que el cuadro de texto muestra otra
 * cosa: la **pantalla**, donde cada ficha se lee `@Juan Pérez` y se sabe en qué
 * tramo está. Cada tecla se aplica sobre la pantalla (`editar`) y de ahí se
 * vuelve a lo guardado (`aGuardado`). Tocar una ficha la borra entera, como en
 * cualquier chat: una ficha a medias ya no nombraría a nadie.
 */

import { z } from "zod";
import { normalizar } from "@/lib/busqueda";
import {
  ORDEN_TIPOS,
  TIPOS_REFERENCIA,
  aliasEnTexto,
  esquemaContexto,
  partirReferencias,
  siguienteAlias,
  type ContextoReferencia,
  type Referencia,
  type TipoReferencia,
} from "./tipos";

// ── El contrato de /api/chat/referencias ────────────────────────────────────

/** Lo que devuelve el buscador: una referencia todavía sin alias (el alias lo pone el campo). */
export type ReferenciaNueva = Omit<Referencia, "alias">;

/**
 * Dónde está parado el menú al navegar por niveles. Plancha: material → color →
 * espesor (un grupo) → formato. Diseño: cliente → pedido → ítem. `migas` es lo
 * que el menú escribe arriba ("Acrílico ECO › Cristal").
 */
export const esquemaNivel = z.object({
  material: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().min(1).max(200).optional(),
  grupoId: z.string().uuid().optional(),
  cliente: esquemaContexto.optional(),
  pedido: z.string().trim().min(1).max(40).optional(),
  migas: z.array(z.string().max(200)).max(5).default([]),
});
export type NivelReferencia = z.infer<typeof esquemaNivel>;

export const NIVEL_RAIZ: NivelReferencia = { migas: [] };

export interface OpcionReferencia {
  /** Única dentro de la respuesta: la `key` de la fila. */
  clave: string;
  etiqueta: string;
  detalle?: string;
  /** Lo que se inserta al elegirla. Sin esto, la fila solo lleva a otro nivel. */
  referencia?: ReferenciaNueva;
  /** El nivel al que se baja desde aquí ("ver sus formatos", "ver sus pedidos"). */
  navegable?: NivelReferencia;
  miniatura?: string | null;
}

export interface RespuestaReferencias {
  opciones: OpcionReferencia[];
  /** Lo que el menú dice arriba cuando hay contexto: "Pedidos de Juan Pérez". */
  titulo: string | null;
  /** Algo que conviene saber: "Odoo no respondió: se muestran los clientes de los pedidos". */
  aviso: string | null;
}

/** La tarjeta de un cliente (`/api/chat/referencias/ficha`). */
export interface FichaCliente {
  tipo: "cliente";
  nombre: string;
  documento: string | null;
  /** Solo si el rol de quien mira lo puede ver (`verTelefonoCliente`). */
  telefono: string | null;
  ciudad: string | null;
  pedidos: { codigo: string; estado: string; fechaCreacion: string }[];
}

/** La tarjeta de una plancha: el grupo, sus formatos y los retazos disponibles. */
export interface FichaPlancha {
  tipo: "plancha";
  material: string;
  color: string;
  espesor: string;
  /** Si la referencia era a un formato, ese. */
  formatoId: string | null;
  formatos: { id: string; codigo: string; medida: string }[];
  sobrantes: number;
}

export type FichaReferencia = FichaCliente | FichaPlancha;

/** Las etiquetas tienen tope en la base (160): se cortan con puntos suspensivos. */
export const recortar = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

// ── Comandos ────────────────────────────────────────────────────────────────

/**
 * Lo que se puede escribir tras la arroba para elegir el tipo, ya normalizado.
 * Se aceptan plurales y el "diseño" con eñe: `@cliente @pedidos` se lee bien.
 */
const COMANDOS: Record<string, TipoReferencia> = {
  cliente: "cliente",
  clientes: "cliente",
  pedido: "pedido",
  pedidos: "pedido",
  plancha: "plancha",
  planchas: "plancha",
  diseno: "diseno",
  disenos: "diseno",
  diseno3d: "diseno",
  disenos3d: "diseno",
  usuario: "usuario",
  usuarios: "usuario",
};

/** "diseño3D" → `"diseno3d"`. Sin tildes ni mayúsculas, y la eñe como ene. */
const comandoNormalizado = (palabra: string) => normalizar(palabra).replace(/\s+/g, "");

/** El tipo que nombra una palabra completa (`pedido`, `Diseño3D`…), o `null`. */
export const tipoDeComando = (palabra: string): TipoReferencia | null =>
  COMANDOS[comandoNormalizado(palabra)] ?? null;

/** Los tipos que empiezan por lo escrito tras la arroba: `pe` → pedido. Vacío → todos. */
export function tiposQueEmpiezan(filtro: string): TipoReferencia[] {
  const f = comandoNormalizado(filtro);
  if (!f) return [...ORDEN_TIPOS];
  return ORDEN_TIPOS.filter(
    (t) =>
      Object.entries(COMANDOS).some(([c, tipo]) => tipo === t && c.startsWith(f)) ||
      comandoNormalizado(TIPOS_REFERENCIA[t].nombre).startsWith(f),
  );
}

// ── La pantalla ─────────────────────────────────────────────────────────────

/** Una ficha en el texto de la pantalla: `[inicio, fin)`. */
export interface Ficha {
  inicio: number;
  fin: number;
  referencia: Referencia;
}

export interface Pantalla {
  texto: string;
  fichas: Ficha[];
}

/** Cómo se lee una ficha en el cuadro de texto. */
export const textoDeFicha = (r: Pick<Referencia, "etiqueta">) => `@${r.etiqueta}`;

/** Lo guardado (`Mira @r1`) a lo que se ve (`Mira @Juan Pérez`). */
export function aPantalla(guardado: string, referencias: Referencia[]): Pantalla {
  let texto = "";
  const fichas: Ficha[] = [];
  for (const trozo of partirReferencias(guardado, referencias)) {
    if (typeof trozo === "string") {
      texto += trozo;
    } else {
      const visible = textoDeFicha(trozo);
      fichas.push({ inicio: texto.length, fin: texto.length + visible.length, referencia: trozo });
      texto += visible;
    }
  }
  return { texto, fichas };
}

/**
 * Lo que se ve a lo que se guarda. Una ficha pegada a una letra (`@r1x`) ya no
 * sería ficha para `PATRON_REFERENCIA`: se separa con un espacio.
 */
export function aGuardado({ texto, fichas }: Pantalla): string {
  let salida = "";
  let desde = 0;
  for (const f of [...fichas].sort((a, b) => a.inicio - b.inicio)) {
    salida += texto.slice(desde, f.inicio) + `@${f.referencia.alias}`;
    if (/^\w/.test(texto.slice(f.fin))) salida += " ";
    desde = f.fin;
  }
  return salida + texto.slice(desde);
}

/** Las referencias que siguen en pantalla, en el orden del texto. */
export const referenciasDe = (p: Pantalla): Referencia[] =>
  [...p.fichas].sort((a, b) => a.inicio - b.inicio).map((f) => f.referencia);

const prefijoComun = (a: string, b: string, tope: number) => {
  let i = 0;
  while (i < tope && a[i] === b[i]) i++;
  return i;
};

/**
 * Aplica lo que el navegador hizo en el cuadro (una tecla, un pegado, un
 * borrado) sobre la pantalla anterior. `cursor` es dónde quedó el caret: lo que
 * hay después de él no cambió, y con eso se sabe qué tramo se tocó aunque el
 * texto se repita ("@Ana" + "a").
 *
 * - Lo escrito antes o después de una ficha la corre de lugar.
 * - Borrar aunque sea una letra de una ficha la quita entera (texto incluido).
 * - Escribir dentro de una ficha sin borrar nada la vuelve texto común.
 *
 * Devuelve también dónde tiene que quedar el caret: si se borró una ficha
 * entera, no es donde lo dejó el navegador.
 */
export function editar(antes: Pantalla, nuevo: string, cursor: number): { pantalla: Pantalla; cursor: number } {
  const viejo = antes.texto;
  let inicio: number;
  let finViejo: number;
  let insertado: string;

  const sufijo = nuevo.length - cursor;
  if (cursor >= 0 && sufijo >= 0 && sufijo <= viejo.length && viejo.slice(viejo.length - sufijo) === nuevo.slice(cursor)) {
    finViejo = viejo.length - sufijo;
    inicio = prefijoComun(viejo, nuevo, Math.min(cursor, finViejo));
    insertado = nuevo.slice(inicio, cursor);
  } else {
    // El caret no dice nada útil (un cambio por programa): el tramo distinto más corto.
    inicio = prefijoComun(viejo, nuevo, Math.min(viejo.length, nuevo.length));
    let s = 0;
    while (
      s < viejo.length - inicio &&
      s < nuevo.length - inicio &&
      viejo[viejo.length - 1 - s] === nuevo[nuevo.length - 1 - s]
    ) {
      s++;
    }
    finViejo = viejo.length - s;
    insertado = nuevo.slice(inicio, nuevo.length - s);
  }

  const borra = finViejo > inicio;
  const tocadas = antes.fichas.filter((f) => f.inicio < finViejo && f.fin > inicio);
  if (borra) {
    // El tramo se agranda hasta cubrir las fichas tocadas: se van enteras.
    for (const f of tocadas) {
      inicio = Math.min(inicio, f.inicio);
      finViejo = Math.max(finViejo, f.fin);
    }
  }
  // Escribir justo tras una ficha pegado a ella la rompería al guardar: un espacio en medio.
  if (!borra && insertado && /^\w/.test(insertado) && antes.fichas.some((f) => f.fin === inicio)) {
    insertado = ` ${insertado}`;
  }

  const delta = insertado.length - (finViejo - inicio);
  const fichas: Ficha[] = [];
  for (const f of antes.fichas) {
    if (f.fin <= inicio) fichas.push(f);
    else if (f.inicio >= finViejo) fichas.push({ ...f, inicio: f.inicio + delta, fin: f.fin + delta });
    // Si no, la tocó: con `borra` se fue con el tramo; sin borrar, queda como texto.
  }

  return {
    pantalla: { texto: viejo.slice(0, inicio) + insertado + viejo.slice(finViejo), fichas },
    cursor: inicio + insertado.length,
  };
}

/** Cambia `[desde, hasta)` por `texto`. El tramo no puede cortar una ficha (las que toca se van). */
export function reemplazar(p: Pantalla, desde: number, hasta: number, texto: string): Pantalla {
  const delta = texto.length - (hasta - desde);
  return {
    texto: p.texto.slice(0, desde) + texto + p.texto.slice(hasta),
    fichas: p.fichas.flatMap((f) =>
      f.fin <= desde ? [f] : f.inicio >= hasta ? [{ ...f, inicio: f.inicio + delta, fin: f.fin + delta }] : [],
    ),
  };
}

/** El primer alias libre, sin pisar un `@rN` que haya quedado suelto en el texto guardado. */
export const aliasLibre = (guardado: string, referencias: Referencia[]) =>
  siguienteAlias([...referencias.map((r) => r.alias), ...aliasEnTexto(guardado)]);

/**
 * Pone una ficha en lugar de `[desde, hasta)` (el `@pedido P26` que se estaba
 * escribiendo), con un espacio detrás para seguir escribiendo.
 */
export function insertarFicha(
  p: Pantalla,
  desde: number,
  hasta: number,
  referencia: Referencia,
): { pantalla: Pantalla; cursor: number } {
  const visible = textoDeFicha(referencia);
  const espacio = /^[ \t]/.test(p.texto.slice(hasta)) ? "" : " ";
  const sinComando = reemplazar(p, desde, hasta, visible + espacio);
  const ficha: Ficha = { inicio: desde, fin: desde + visible.length, referencia };
  return {
    pantalla: { texto: sinComando.texto, fichas: [...sinComando.fichas, ficha].sort((a, b) => a.inicio - b.inicio) },
    // Tras el espacio, sea el nuevo o el que ya estaba.
    cursor: desde + visible.length + 1,
  };
}

// ── El @ que se está escribiendo ────────────────────────────────────────────

export type ComandoEnCurso =
  /** `@pe`: todavía eligiendo el tipo. `filtro` es lo escrito tras la arroba. */
  | { modo: "tipos"; inicio: number; fin: number; filtro: string }
  /** `@pedido P26`: buscando. `consulta` es lo escrito después del comando. */
  | { modo: "buscar"; inicio: number; fin: number; tipo: TipoReferencia; consulta: string };

/** Hasta dónde se mira hacia atrás: una consulta no es un párrafo. */
const MAX_COMANDO = 80;

/**
 * El `@` que se está escribiendo, según dónde está el caret. Cuenta solo una
 * arroba al principio o tras un espacio (un correo `a@b.com` no abre nada) y que
 * no sea de una ficha. Tras un comando conocido y un espacio, lo que sigue es la
 * consulta, con espacios y todo (`@cliente juan perez`).
 */
export function comandoEnCurso(p: Pantalla, cursor: number): ComandoEnCurso | null {
  const { texto, fichas } = p;
  if (cursor < 1 || cursor > texto.length) return null;
  if (fichas.some((f) => f.inicio < cursor && cursor < f.fin)) return null;

  for (let i = cursor - 1; i >= Math.max(0, cursor - MAX_COMANDO); i--) {
    const c = texto[i];
    if (c === "\n") return null;
    if (fichas.some((f) => f.inicio <= i && i < f.fin)) return null;
    if (c !== "@" || (i > 0 && !/\s/.test(texto[i - 1]))) continue;

    const token = texto.slice(i + 1, cursor);
    const partes = /^(\S+)\s+([\s\S]*)$/.exec(token);
    if (partes) {
      const tipo = tipoDeComando(partes[1]);
      return tipo ? { modo: "buscar", inicio: i, fin: cursor, tipo, consulta: partes[2] } : null;
    }
    if (token.includes("@")) return null;
    // El resto de la palabra tras el caret también es del comando: `@pe|dido`.
    const resto = /^\S*/.exec(texto.slice(cursor))?.[0] ?? "";
    return { modo: "tipos", inicio: i, fin: cursor + resto.length, filtro: token };
  }
  return null;
}

/** Las entidades que encadenan: un cliente y/o un pedido justo antes. */
const ENCADENAN: TipoReferencia[] = ["cliente", "pedido"];

/**
 * El contexto de un `@` nuevo: las fichas de cliente y/o pedido pegadas antes de
 * él, con solo espacios en medio. `@Juan Pérez @P2611-001 @` → [cliente, pedido].
 * Uno de cada tipo como mucho, en el orden del texto.
 */
export function contextoEncadenado(p: Pantalla, inicio: number): ContextoReferencia[] {
  const contexto: ContextoReferencia[] = [];
  let j = inicio;
  for (;;) {
    while (j > 0 && /[ \t]/.test(p.texto[j - 1])) j--;
    const ficha = p.fichas.find((f) => f.fin === j);
    if (!ficha || !ENCADENAN.includes(ficha.referencia.tipo)) break;
    if (contexto.some((c) => c.tipo === ficha.referencia.tipo)) break;
    const { tipo, id, etiqueta } = ficha.referencia;
    contexto.unshift({ tipo, id, etiqueta });
    j = ficha.inicio;
  }
  return contexto;
}

/** Lo que el menú propone primero con contexto: "Pedidos de Juan Pérez", "Diseños del pedido P2611-001". */
export function sugerenciasDeContexto(contexto: ContextoReferencia[]): { tipo: TipoReferencia; texto: string }[] {
  const pedido = contexto.find((c) => c.tipo === "pedido");
  const cliente = contexto.find((c) => c.tipo === "cliente");
  if (pedido) return [{ tipo: "diseno", texto: `Diseños del pedido ${pedido.etiqueta}` }];
  if (cliente) {
    return [
      { tipo: "pedido", texto: `Pedidos de ${cliente.etiqueta}` },
      { tipo: "diseno", texto: `Diseños de ${cliente.etiqueta}` },
    ];
  }
  return [];
}

/** Si un tipo usa el contexto encadenado (a los demás no les cambia nada). */
export const usaContexto = (tipo: TipoReferencia, contexto: ContextoReferencia[]) =>
  (tipo === "pedido" && contexto.some((c) => c.tipo === "cliente")) || (tipo === "diseno" && contexto.length > 0);

/** El texto que ocupa un comando elegido en el menú: `@pedido `. */
export const textoDeComando = (tipo: TipoReferencia) => `@${TIPOS_REFERENCIA[tipo].comando} `;

// ── Enlaces ─────────────────────────────────────────────────────────────────

/** A dónde lleva tocar una ficha, si es un enlace (pedido y diseño). */
export function enlaceDeReferencia(r: Pick<Referencia, "tipo" | "id" | "datos">): string | null {
  if (r.tipo === "pedido") return `/pedidos/${encodeURIComponent(r.id)}`;
  if (r.tipo === "diseno") {
    const version = r.datos?.version;
    const sufijo = typeof version === "number" && version > 0 ? `?version=${version}` : "";
    return `/disenos/${encodeURIComponent(r.id)}${sufijo}`;
  }
  return null;
}

/** El id de partner de Odoo de un cliente, o `null` si es un cliente de texto (`n:<nombre>`). */
export const partnerDeCliente = (id: string): number | null => (/^\d{1,10}$/.test(id) ? Number(id) : null);

/** El nombre con el que buscar sus pedidos en texto: el de `n:<nombre>` o la etiqueta. */
export const nombreDeCliente = (c: Pick<ContextoReferencia, "id" | "etiqueta">) =>
  c.id.startsWith("n:") ? c.id.slice(2) : c.etiqueta;
