/**
 * Lo que hace el webhook de WhatsApp con cada lote de mensajes, del lado del
 * servidor. Llega sin sesión: todo lo de la base pasa por las funciones `wa_*`
 * con la clave del agente (`secreto.ts`), y lo de WhatsApp por Kapso (`canal.ts`).
 *
 * Por cada conversación del lote:
 *   1. Guarda los mensajes (los repetidos, por wamid, se saltan).
 *   2. Si llegó algo nuevo del cliente y la conversación es del agente, lo hace
 *      responder con el mismo motor que el área de pruebas.
 *   3. Guarda la respuesta solo si la conversación sigue siendo del agente, y
 *      entonces la manda por WhatsApp. Si el agente derivó, no manda nada.
 *   4. Si algo falla (el modelo, el envío), la conversación pasa a "necesita
 *      atención": que la vea una persona antes que dejar al cliente sin respuesta.
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { pdfComoArchivo, type ParteLlm } from "@/lib/llm/inferhub";
import { paginasDePdf } from "@/lib/pdf-texto";
import { deGrupo, type FilaGrupo } from "@/lib/cortes-servidor";
import { armarDatosListaPrecios } from "@/lib/lista-precios-servidor";
import { leerConfigListaPrecios } from "@/lib/lista-precios-config";
import { leerConfigEmpresa } from "@/lib/empresa-config";
import { MONEDAS_CUENTA, TIPOS_CUENTA, type MonedaCuenta, type TipoCuenta } from "@/lib/cuentas-bancarias";
import { deAdjuntos, esTipoAdjunto, type TipoAdjunto } from "@/lib/cad/adjuntos";
import type { Json } from "@/lib/supabase-tipos";
import { leerAjustesAgente } from "./ajustes";
import { clienteWhatsApp, enviarRespuesta } from "./canal";
import { agenteConfigurado, perfilDelAgente } from "./config";
import { fragmentosDeFilas, vectorDeConsulta } from "./conocimiento-servidor";
import { unaVez } from "./contexto-servidor";
import type { ArchivoEnviable, ContextoHerramientas } from "./herramientas";
import { responderMensaje } from "./motor";
import { buscarPrecios } from "./precios";
import { leerAnuncio, leerAdjuntos, leerRol } from "./pruebas";
import { AGENTE_SIN_SECRETO, claveDelAgente } from "./secreto";
import { BUCKET_CONOCIMIENTO, esMimeDocumento, esTipoDocumento, type AdjuntoCliente, type TurnoHistorial } from "./tipos";
import { leerAdjuntosWhatsapp, type AdjuntoWhatsapp, type EventoWhatsapp } from "./webhook";

type Supabase = Awaited<ReturnType<typeof clienteServidor>>;

/** Cuántos archivos del cliente van enteros al modelo; los anteriores, solo nombrados. */
const ADJUNTOS_ENTEROS = 4;
/** Lo que pesa como mucho un archivo que se le pasa al modelo. */
const MAX_BYTES_MEDIO = 10 * 1024 * 1024;

const log = (...args: unknown[]) => console.error("[whatsapp]", ...args);

/* ── El contexto del agente, sin sesión ──────────────────────────────────────── */

interface DatosWa {
  empresa: unknown;
  ajustes: unknown;
  lista_precios: unknown;
  cuentas: { banco: string; tipo: string; moneda: string; numero: string; cci: string | null }[];
  archivos: { id: string; nombre: string; tipo: string; mime: string; descripcion: string; ruta: string }[];
}

/** El contexto del agente leído con la clave, para el webhook. */
export function contextoWhatsapp(supabase: Supabase, clave: string) {
  const datos = unaVez(async (): Promise<DatosWa> => {
    const { data, error } = await supabase.rpc("wa_contexto", { p_clave: clave });
    if (error) throw new Error(`No se pudo leer el contexto del agente: ${error.message}`);
    return data as unknown as DatosWa;
  });

  const lista = unaVez(async () => {
    const { data, error } = await supabase.rpc("wa_catalogo", { p_clave: clave });
    if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`);
    const c = data as unknown as {
      grupos: FilaGrupo[];
      accesorios: { codigo_odoo: string; categoria_id: string; activo: boolean }[];
      categorias: { id: string; nombre: string; orden: number }[];
    };
    const grupos = c.grupos
      .map(deGrupo)
      .map((g) => ({ ...g, formatos: g.formatos.filter((f) => f.activo) }))
      .filter((g) => g.formatos.length > 0);
    return armarDatosListaPrecios(grupos, c.accesorios, c.categorias);
  });

  const archivos = async (): Promise<(ArchivoEnviable & { ruta: string })[]> =>
    (await datos()).archivos.flatMap((a) =>
      esTipoDocumento(a.tipo) && esMimeDocumento(a.mime)
        ? [{ documentoId: a.id, nombre: a.nombre, tipo: a.tipo, mime: a.mime, descripcion: a.descripcion, ruta: a.ruta }]
        : [],
    );

  const contexto: ContextoHerramientas = {
    buscarPrecios: async (consulta) => buscarPrecios(await lista(), consulta),
    buscarInformacion: async (consulta) => {
      const vector = await vectorDeConsulta(consulta);
      const { data, error } = await supabase.rpc("wa_buscar_fragmentos", {
        p_clave: clave,
        p_texto: consulta,
        ...vector,
        p_limite: 6,
      });
      if (error) throw new Error(`No se pudo buscar en los documentos: ${error.message}`);
      return fragmentosDeFilas(data ?? []);
    },
    datosEmpresa: async () => {
      const d = await datos();
      return {
        ...leerConfigEmpresa(d.empresa),
        cuentas: d.cuentas.map((c) => ({
          banco: c.banco,
          tipo: TIPOS_CUENTA[c.tipo as TipoCuenta] ?? c.tipo,
          moneda: MONEDAS_CUENTA[c.moneda as MonedaCuenta] ?? c.moneda,
          numero: c.numero,
          cci: c.cci,
        })),
      };
    },
    archivosEnviables: archivos,
  };

  return { contexto, datos, archivos };
}

/* ── Los archivos del cliente ────────────────────────────────────────────────── */

/** Baja un archivo de Kapso (con su clave). */
async function bajarDeKapso(url: string): Promise<Buffer> {
  const respuesta = await fetch(url, {
    headers: { "X-API-Key": process.env.KAPSO_API_KEY?.trim() ?? "" },
    cache: "no-store",
  });
  if (!respuesta.ok) throw new Error(`Kapso respondió ${respuesta.status} al bajar un archivo`);
  const bytes = Buffer.from(await respuesta.arrayBuffer());
  if (bytes.length > MAX_BYTES_MEDIO) throw new Error("el archivo pesa demasiado");
  return bytes;
}

/** Lo que el modelo ve de un archivo de WhatsApp: imagen o PDF. Lo demás, solo nombrado. */
async function partesDeMedio(a: AdjuntoWhatsapp): Promise<ParteLlm[] | undefined> {
  if (!esTipoAdjunto(a.mime)) return undefined;
  try {
    const bytes = await bajarDeKapso(a.url);
    if (a.mime.startsWith("image/")) {
      return [
        { tipo: "texto", texto: `[Imagen adjunta: ${a.nombre}]` },
        { tipo: "imagen", url: `data:${a.mime};base64,${bytes.toString("base64")}` },
      ];
    }
    if (pdfComoArchivo()) {
      return [
        { tipo: "texto", texto: `[PDF adjunto: ${a.nombre}]` },
        { tipo: "archivo", nombre: a.nombre, mime: a.mime, datos: bytes.toString("base64") },
      ];
    }
    const { paginas } = await paginasDePdf(bytes, { maxPaginas: 20, maxCaracteres: 20_000 });
    const texto = paginas.map((p) => `— Página ${p.numero} —\n${p.texto}`).join("\n\n");
    return [{ tipo: "texto", texto: texto ? `[PDF adjunto: ${a.nombre}]\n${texto}` : `[PDF adjunto sin texto: ${a.nombre}]` }];
  } catch (e) {
    log("bajar archivo", e instanceof Error ? e.message : e);
    return [{ tipo: "texto", texto: `[Adjuntó ${a.nombre}, pero no se pudo abrir]` }];
  }
}

/** Un archivo de WhatsApp como adjunto del cliente para el motor (la "ruta" es su URL de Kapso). */
const comoAdjuntoCliente = (a: AdjuntoWhatsapp): AdjuntoCliente => ({
  ruta: a.url,
  nombre: a.nombre,
  mime: a.mime as TipoAdjunto,
  tamano: a.tamano,
});

/* ── Responder ───────────────────────────────────────────────────────────────── */

async function pedirAtencion(supabase: Supabase, clave: string, conversacion: string, motivo: string) {
  const { error } = await supabase.rpc("wa_pedir_atencion", {
    p_clave: clave,
    p_conversacion: conversacion,
    p_motivo: motivo.slice(0, 300),
  });
  if (error) log("pedir atención", error.message);
}

async function responder(
  supabase: Supabase,
  clave: string,
  c: { conversacion: string; phoneNumberId: string; telefono: string; ultimoWamid: string; anuncio: unknown },
) {
  if (!agenteConfigurado()) return pedirAtencion(supabase, clave, c.conversacion, "el agente no está configurado");
  const whatsapp = clienteWhatsApp();
  if (!whatsapp) return pedirAtencion(supabase, clave, c.conversacion, "falta la clave de Kapso (KAPSO_API_KEY)");

  // "Escribiendo…" en el teléfono del cliente mientras el agente piensa. Si falla, da igual.
  whatsapp.messages
    .markRead({ phoneNumberId: c.phoneNumberId, messageId: c.ultimoWamid, typingIndicator: { type: "text" } })
    .catch((e: unknown) => log("marcar leído", e instanceof Error ? e.message : e));

  const { data: filas, error } = await supabase.rpc("wa_historial", { p_clave: clave, p_conversacion: c.conversacion });
  if (error) return pedirAtencion(supabase, clave, c.conversacion, `no se pudo leer la conversación: ${error.message}`);

  const historial: TurnoHistorial[] = (filas ?? []).map((f) => {
    const rol = leerRol(f.rol);
    return {
      rol,
      contenido: f.contenido,
      adjuntos: rol === "agente" ? leerAdjuntos(f.adjuntos) : undefined,
      adjuntosCliente:
        rol === "cliente" ? [...deAdjuntos(f.adjuntos), ...leerAdjuntosWhatsapp(f.adjuntos).map(comoAdjuntoCliente)] : undefined,
    };
  });

  // Los archivos más recientes del cliente van enteros (imagen o PDF).
  const medios = (filas ?? []).flatMap((f) => (leerRol(f.rol) === "cliente" ? leerAdjuntosWhatsapp(f.adjuntos) : []));
  const recientes = medios.slice(-ADJUNTOS_ENTEROS);
  const partes = new Map<string, ParteLlm[] | undefined>(
    await Promise.all(recientes.map(async (a) => [a.url, await partesDeMedio(a)] as const)),
  );

  const { contexto, datos, archivos } = contextoWhatsapp(supabase, clave);
  let respuesta;
  try {
    const d = await datos();
    respuesta = await responderMensaje({
      historial,
      anuncio: leerAnuncio(c.anuncio),
      ajustes: leerAjustesAgente(d.ajustes),
      contexto,
      perfil: perfilDelAgente(),
      notaPrecios: leerConfigListaPrecios(d.lista_precios).notaPie,
      partesDe: (a) => partes.get(a.ruta),
    });
  } catch (e) {
    log("responder", e);
    return pedirAtencion(supabase, clave, c.conversacion, `el agente falló: ${e instanceof Error ? e.message : "error"}`);
  }

  const textos = respuesta.mensajes.flatMap((m) => (m.tipo === "texto" ? [m.texto] : []));
  const enviados = respuesta.mensajes.flatMap((m) => (m.tipo === "archivo" ? [{ ...m.adjunto, texto: m.texto }] : []));
  const { data: puede, error: errorGuardar } = await supabase.rpc("wa_guardar_respuesta", {
    p_clave: clave,
    p_conversacion: c.conversacion,
    p_contenido: textos.join("\n\n"),
    p_adjuntos: (enviados.length ? enviados : null) as unknown as Json,
    p_traza: respuesta.traza as unknown as Json,
    p_derivado: respuesta.derivado,
    p_motivo: respuesta.motivoDerivacion ?? null,
  });
  if (errorGuardar) return log("guardar respuesta", errorGuardar.message);
  // Un asesor la tomó mientras el agente pensaba, o el agente derivó: no se manda nada.
  if (!puede || respuesta.mensajes.length === 0) return;

  try {
    const rutas = new Map((await archivos()).map((a) => [a.documentoId, a.ruta]));
    const aFirmar = enviados.flatMap((a) => (rutas.has(a.documentoId) ? [rutas.get(a.documentoId)!] : []));
    const enlaces = new Map<string, string>();
    if (aFirmar.length) {
      const { data } = await supabase.storage.from(BUCKET_CONOCIMIENTO).createSignedUrls(aFirmar, 3600);
      const porRuta = new Map((data ?? []).flatMap((x) => (x.path && x.signedUrl ? [[x.path, x.signedUrl] as const] : [])));
      for (const [id, ruta] of rutas) if (porRuta.has(ruta)) enlaces.set(id, porRuta.get(ruta)!);
    }
    await enviarRespuesta(whatsapp, { phoneNumberId: c.phoneNumberId, to: c.telefono }, respuesta.mensajes, enlaces);
  } catch (e) {
    log("enviar", e);
    await pedirAtencion(
      supabase,
      clave,
      c.conversacion,
      `no se pudo enviar por WhatsApp: ${e instanceof Error ? e.message : "error"}`,
    );
  }
}

/* ── El lote ─────────────────────────────────────────────────────────────────── */

/** Guarda los mensajes de un webhook y, donde toca, hace responder al agente. Nunca lanza. */
export async function procesarEventos(eventos: EventoWhatsapp[]): Promise<void> {
  if (eventos.length === 0) return;
  const clave = claveDelAgente();
  if (!clave) return log(AGENTE_SIN_SECRETO);
  const supabase = await clienteServidor();

  // Por conversación, en orden; conversaciones distintas, en paralelo.
  const porConversacion = new Map<string, EventoWhatsapp[]>();
  for (const e of eventos) {
    const clavePar = `${e.phoneNumberId}|${e.telefono}`;
    porConversacion.set(clavePar, [...(porConversacion.get(clavePar) ?? []), e]);
  }

  await Promise.all(
    [...porConversacion.values()].map(async (lote) => {
      try {
        let ultimo: { conversacion: string; estado: string; anuncio: unknown } | null = null;
        let nuevoDelCliente: EventoWhatsapp | null = null;
        for (const e of lote) {
          const { data, error } = await supabase.rpc("wa_recibir_mensaje", {
            p_clave: clave,
            p_phone_number_id: e.phoneNumberId,
            p_telefono: e.telefono,
            p_contacto: e.contacto,
            p_wamid: e.wamid,
            p_rol: e.rol,
            p_contenido: e.texto,
            p_adjuntos: (e.adjuntos.length ? e.adjuntos : null) as unknown as Json,
            p_anuncio: (e.anuncio ?? null) as unknown as Json,
            p_creado_en: e.creadoEn,
          });
          const r = data?.[0];
          if (error || !r) {
            log("guardar mensaje", error?.message ?? "sin respuesta");
            continue;
          }
          ultimo = { conversacion: r.conversacion_id, estado: r.estado, anuncio: r.anuncio };
          if (!r.duplicado && e.rol === "cliente") nuevoDelCliente = e;
          // Si el equipo respondió desde el celular, lo que vino antes ya lo atendió una persona.
          if (!r.duplicado && e.rol === "asesor") nuevoDelCliente = null;
        }
        if (ultimo && nuevoDelCliente && ultimo.estado === "agente") {
          await responder(supabase, clave, {
            conversacion: ultimo.conversacion,
            phoneNumberId: nuevoDelCliente.phoneNumberId,
            telefono: nuevoDelCliente.telefono,
            ultimoWamid: nuevoDelCliente.wamid,
            anuncio: ultimo.anuncio,
          });
        }
      } catch (e) {
        log("procesar", e);
      }
    }),
  );
}
