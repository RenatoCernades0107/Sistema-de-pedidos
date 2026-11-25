/**
 * La base de conocimiento del agente, del lado del servidor: convertir un
 * archivo subido en fragmentos con su vector, y buscar entre ellos.
 *
 * Todo con la sesión de quien lo pide (Administración): las políticas de
 * `agente_documentos`, `agente_fragmentos` y del bucket son `es_admin()`.
 *
 *   PDF con texto → pdf.js, página por página → fragmentos.
 *   PDF escaneado → el modelo de chat lo transcribe → fragmentos.
 *   Foto          → el modelo de chat la describe (Administración la corrige) → un fragmento.
 *
 * Los vectores se piden al primer modelo de embeddings que responda. Si ninguno
 * responde, el documento queda igual listo, buscable por palabras, con un aviso.
 */

import { crearEmbeddings, transmitirChat, ErrorLlm, pdfComoArchivo, type ParteLlm } from "@/lib/llm/inferhub";
import { paginasDePdf, type PaginaPdf } from "@/lib/pdf-texto";
import { clienteServidor } from "@/lib/supabase-servidor";
import { agenteConfigurado, DIMENSIONES_EMBEDDING, modelosDeEmbeddings, perfilDelAgente } from "./config";
import type { ArchivoEnviable, FragmentoEncontrado } from "./herramientas";
import { paginasDeTranscripcion, trocearPaginas, trocearTexto, type Fragmento } from "./trocear";
import {
  BUCKET_CONOCIMIENTO,
  TIPOS_DOCUMENTO,
  esMimeDocumento,
  esTipoDocumento,
  type DocumentoAgente,
  type EstadoDocumento,
} from "./tipos";

/** De cuántas páginas de un PDF se saca el texto. */
const MAX_PAGINAS = 300;
/** Como mucho, por documento: un catálogo enorme no debe llenar la base. */
const MAX_FRAGMENTOS = 2000;
/** Un PDF escaneado más grande que esto no se manda a transcribir. */
const MAX_BYTES_TRANSCRIBIR = 15 * 1024 * 1024;
/** Si un PDF trae menos texto que esto, se considera escaneado. */
const MIN_CARACTERES_PDF = 80;

/* ── Listar ────────────────────────────────────────────────────────────────── */

type FilaDocumento = {
  id: string;
  nombre: string;
  tipo: string;
  mime: string;
  ruta: string;
  tamano: number;
  descripcion: string;
  estado: string;
  error: string | null;
  enviable: boolean;
  paginas: number | null;
  creado_en: string;
  agente_fragmentos?: { count: number }[];
};

function documentoDeFila(f: FilaDocumento): DocumentoAgente | null {
  if (!esTipoDocumento(f.tipo) || !esMimeDocumento(f.mime)) return null;
  return {
    id: f.id,
    nombre: f.nombre,
    tipo: f.tipo,
    mime: f.mime,
    ruta: f.ruta,
    tamano: f.tamano,
    descripcion: f.descripcion,
    estado: (["procesando", "listo", "error"].includes(f.estado) ? f.estado : "error") as EstadoDocumento,
    error: f.error,
    enviable: f.enviable,
    paginas: f.paginas,
    fragmentos: f.agente_fragmentos?.[0]?.count ?? 0,
    creadoEn: f.creado_en,
  };
}

/** Los documentos de la base de conocimiento, el más nuevo primero, con cuántos fragmentos tiene cada uno. */
export async function cargarDocumentos(): Promise<DocumentoAgente[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_documentos")
    .select("id, nombre, tipo, mime, ruta, tamano, descripcion, estado, error, enviable, paginas, creado_en, agente_fragmentos(count)")
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los documentos del agente: ${error.message}`);
  return ((data ?? []) as unknown as FilaDocumento[]).flatMap((f) => documentoDeFila(f) ?? []);
}

/** Los archivos listos que el agente puede mandar al cliente. */
export async function cargarArchivosEnviables(): Promise<ArchivoEnviable[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_documentos")
    .select("id, nombre, tipo, mime, descripcion")
    .eq("estado", "listo")
    .eq("enviable", true)
    .order("creado_en", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((d): ArchivoEnviable[] =>
    esTipoDocumento(d.tipo) && esMimeDocumento(d.mime)
      ? [{ documentoId: d.id, nombre: d.nombre, tipo: d.tipo, mime: d.mime, descripcion: d.descripcion }]
      : [],
  );
}

/** Enlaces temporales a los archivos, por id de documento: para verlos en la pantalla o mandarlos por WhatsApp. */
export async function enlacesDeDocumentos(ids: string[], segundos = 3600): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const supabase = await clienteServidor();
  const { data: docs } = await supabase.from("agente_documentos").select("id, ruta").in("id", unicos);
  if (!docs?.length) return new Map();
  const { data } = await supabase.storage.from(BUCKET_CONOCIMIENTO).createSignedUrls(
    docs.map((d) => d.ruta),
    segundos,
  );
  const porRuta = new Map((data ?? []).flatMap((x) => (x.path && x.signedUrl ? [[x.path, x.signedUrl] as const] : [])));
  return new Map(docs.flatMap((d) => (porRuta.has(d.ruta) ? [[d.id, porRuta.get(d.ruta)!] as const] : [])));
}

/* ── Vectores ──────────────────────────────────────────────────────────────── */

/**
 * Los vectores de los textos con el primer modelo que responda. `null` si
 * ninguno respondió (o no hay clave): se busca solo por palabras.
 */
async function vectorizar(
  textos: string[],
): Promise<{ vectores: number[][]; modelo: string } | { vectores: null; error: string }> {
  if (!agenteConfigurado()) return { vectores: null, error: "falta la clave del agente" };
  const { clave } = perfilDelAgente();
  const errores: string[] = [];
  for (const modelo of modelosDeEmbeddings()) {
    try {
      const vectores = await crearEmbeddings(textos, { clave, modelo, dimensiones: DIMENSIONES_EMBEDDING });
      return { vectores, modelo };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[agente-whatsapp] embeddings con ${modelo}`, mensaje);
      errores.push(`${modelo}: ${mensaje}`);
    }
  }
  return { vectores: null, error: errores.join(" · ") };
}

/* ── Leer el archivo ───────────────────────────────────────────────────────── */

/** Todo el texto que devuelve el modelo, sin herramientas. */
async function pedirTexto(sistema: string, partes: ParteLlm[]): Promise<string> {
  let texto = "";
  for await (const e of transmitirChat({
    sistema,
    mensajes: [{ rol: "usuario", contenido: partes }],
    perfil: perfilDelAgente(),
  })) {
    if (e.tipo === "texto") texto += e.delta;
  }
  return texto.trim();
}

const SISTEMA_FOTO =
  "Describes fotos de productos y trabajos de Plexiacril (planchas de acrílico, policarbonato, MDF, letreros, " +
  "exhibidores, cajas, cortes láser) para un buscador interno. En 2 a 4 oraciones en español: qué es, material " +
  "aparente, color, acabado y para qué sirve o dónde se usa. Si ves texto o marcas en la foto, inclúyelos. " +
  "No inventes medidas, espesores ni precios. Solo la descripción, sin introducciones.";

/** La descripción de una foto, escrita por el modelo. */
export async function describirImagen(bytes: Uint8Array, mime: string, nombre: string): Promise<string> {
  const datos = Buffer.from(bytes).toString("base64");
  return pedirTexto(SISTEMA_FOTO, [
    { tipo: "texto", texto: `Archivo: ${nombre}` },
    { tipo: "imagen", url: `data:${mime};base64,${datos}` },
  ]);
}

const SISTEMA_TRANSCRIBIR =
  "Transcribes documentos escaneados (catálogos y fichas técnicas) a texto plano en español, fielmente, sin resumir " +
  "ni inventar. Conserva nombres de productos, medidas, espesores, colores, códigos y tablas (una fila por línea, " +
  "columnas separadas por ' | '). Empieza cada página con una línea '=== Página N ==='.";

/** Las páginas de un PDF escaneado, transcritas por el modelo. */
async function transcribirPdf(bytes: Uint8Array, nombre: string): Promise<PaginaPdf[]> {
  const texto = await pedirTexto(SISTEMA_TRANSCRIBIR, [
    { tipo: "archivo", nombre, mime: "application/pdf", datos: Buffer.from(bytes).toString("base64") },
  ]);
  return paginasDeTranscripcion(texto);
}

/* ── Procesar ──────────────────────────────────────────────────────────────── */

export type ResultadoProceso =
  | { ok: true; fragmentos: number; modelo: string | null; aviso: string | null }
  | { ok: false; error: string };

function mensajeDe(e: unknown): string {
  if (e instanceof ErrorLlm) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Lee el archivo de un documento, lo parte en fragmentos, calcula sus vectores
 * y reemplaza los que tenía. Sirve para la primera vez y para reindexar.
 * Deja el documento en `listo` o en `error` (con el motivo); nunca a medias.
 */
export async function procesarDocumento(id: string): Promise<ResultadoProceso> {
  const supabase = await clienteServidor();
  const { data: doc, error: errorDoc } = await supabase
    .from("agente_documentos")
    .select("id, nombre, tipo, mime, ruta, descripcion")
    .eq("id", id)
    .maybeSingle();
  if (errorDoc || !doc) return { ok: false, error: "El documento no existe." };

  const fallar = async (error: string): Promise<ResultadoProceso> => {
    await supabase
      .from("agente_documentos")
      .update({ estado: "error", error: error.slice(0, 1000), actualizado_en: new Date().toISOString() })
      .eq("id", id);
    return { ok: false, error };
  };

  await supabase
    .from("agente_documentos")
    .update({ estado: "procesando", error: null, actualizado_en: new Date().toISOString() })
    .eq("id", id);

  try {
    const { data: blob, error: errorArchivo } = await supabase.storage.from(BUCKET_CONOCIMIENTO).download(doc.ruta);
    if (errorArchivo || !blob) return fallar("No se encontró el archivo en el almacenamiento. Vuelve a subirlo.");
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const titulo = `${TIPOS_DOCUMENTO[esTipoDocumento(doc.tipo) ? doc.tipo : "otro"]}: ${doc.nombre}`;
    let fragmentos: Fragmento[] = [];
    let paginas: number | null = null;
    let descripcion = doc.descripcion;

    if (doc.mime === "application/pdf") {
      let leidas: PaginaPdf[] = [];
      try {
        const r = await paginasDePdf(bytes, { maxPaginas: MAX_PAGINAS });
        leidas = r.paginas;
        paginas = r.total;
      } catch (e) {
        console.error("[agente-whatsapp] leer el PDF", e);
        return fallar("No se pudo leer el PDF. ¿Está dañado o protegido con contraseña?");
      }
      const caracteres = leidas.reduce((n, p) => n + p.texto.length, 0);
      if (caracteres < MIN_CARACTERES_PDF) {
        // Escaneado: sin texto que sacar. Lo transcribe el modelo, si se puede.
        if (!agenteConfigurado()) return fallar("El PDF no tiene texto (¿escaneado?) y el agente no tiene clave para transcribirlo.");
        if (!pdfComoArchivo()) return fallar("El PDF no tiene texto (¿escaneado?) y la pasarela no acepta PDF (INFERHUB_PDF=texto).");
        if (bytes.length > MAX_BYTES_TRANSCRIBIR) return fallar("El PDF no tiene texto (¿escaneado?) y es demasiado grande para transcribirlo: súbelo por partes.");
        leidas = await transcribirPdf(bytes, doc.nombre);
        if (leidas.length === 0) return fallar("El PDF no tiene texto y el modelo no pudo transcribirlo.");
      }
      fragmentos = trocearPaginas(leidas);
      if (descripcion.trim()) fragmentos.unshift({ pagina: null, contenido: descripcion.trim() });
    } else {
      if (!descripcion.trim() && agenteConfigurado()) {
        descripcion = (await describirImagen(bytes, doc.mime, doc.nombre)).slice(0, 4000);
      }
      const texto = descripcion.trim() || doc.nombre;
      fragmentos = trocearTexto(texto).map((contenido) => ({ pagina: null, contenido }));
    }

    fragmentos = fragmentos.slice(0, MAX_FRAGMENTOS).map((f) => ({
      ...f,
      // El nombre del documento va en el texto: ayuda a la búsqueda por palabras ("catálogo de policarbonato").
      contenido: `[${titulo}${f.pagina ? ` · pág. ${f.pagina}` : ""}]\n${f.contenido}`,
    }));
    if (fragmentos.length === 0) return fallar("El archivo no tiene texto que indexar.");

    const vectores = await vectorizar(fragmentos.map((f) => f.contenido));

    const { error: errorBorrar } = await supabase.from("agente_fragmentos").delete().eq("documento_id", id);
    if (errorBorrar) return fallar(`No se pudieron reemplazar los fragmentos: ${errorBorrar.message}`);
    const filas = fragmentos.map((f, i) => ({
      documento_id: id,
      orden: i,
      pagina: f.pagina,
      contenido: f.contenido,
      embedding: vectores.vectores ? JSON.stringify(vectores.vectores[i]) : null,
      modelo_embedding: vectores.vectores ? vectores.modelo : null,
    }));
    for (let i = 0; i < filas.length; i += 100) {
      const { error } = await supabase.from("agente_fragmentos").insert(filas.slice(i, i + 100));
      if (error) return fallar(`No se pudieron guardar los fragmentos: ${error.message}`);
    }

    const aviso = vectores.vectores
      ? null
      : `Indexado solo por palabras: no respondió el modelo de embeddings (${vectores.error}). Pulsa "Reindexar" más tarde.`;
    await supabase
      .from("agente_documentos")
      .update({
        estado: "listo",
        error: aviso?.slice(0, 1000) ?? null,
        paginas,
        descripcion,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", id);
    return { ok: true, fragmentos: filas.length, modelo: vectores.vectores ? vectores.modelo : null, aviso };
  } catch (e) {
    console.error("[agente-whatsapp] procesar documento", e);
    return fallar(`No se pudo procesar: ${mensajeDe(e).slice(0, 300)}`);
  }
}

/* ── Buscar ────────────────────────────────────────────────────────────────── */

/** Los fragmentos más relevantes para la consulta (vector + palabras). */
export async function buscarEnConocimiento(consulta: string, limite = 6): Promise<FragmentoEncontrado[]> {
  const vector = await vectorizar([consulta.slice(0, 2000)]);
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("buscar_fragmentos_agente", {
    p_texto: consulta,
    p_embedding: vector.vectores ? JSON.stringify(vector.vectores[0]) : null,
    p_modelo: vector.vectores ? vector.modelo : null,
    p_limite: limite,
  });
  if (error) throw new Error(`No se pudo buscar en los documentos: ${error.message}`);
  return (data ?? []).map((f) => ({
    documentoId: f.documento_id,
    documento: f.documento_nombre,
    tipo: esTipoDocumento(f.documento_tipo) ? f.documento_tipo : "otro",
    pagina: f.pagina,
    contenido: f.contenido,
    enviable: f.documento_enviable,
  }));
}
