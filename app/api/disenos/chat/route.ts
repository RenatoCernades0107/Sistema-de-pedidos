/**
 * Un turno de conversación con el asistente de diseños, en streaming.
 *
 * `POST { disenoId, mensaje, referencias? }` → `text/event-stream`. Cada `data:` es un JSON con
 * `tipo` (`components/disenos/chat-sse.ts`): el texto según llega, las
 * herramientas que usa, `diseno` cuando generó uno (para que el visor lo
 * muestre), `error` y `fin`.
 *
 * El bucle de herramientas corre aquí, en el servidor: el modelo pide, la app
 * ejecuta (`lib/cad/herramientas.ts`), el resultado vuelve al modelo, y así
 * hasta que contesta sin pedir nada más. El navegador solo mira.
 *
 * Es un route handler y no una Server Action porque una Server Action no
 * transmite. Y como responde a un `fetch`, la puerta contesta JSON (401/403) en
 * vez de redirigir al login.
 *
 * Qué se guarda: el mensaje de la persona y la respuesta van a `cad_mensajes`
 * al cerrar el turno, juntos. Si el turno falla sin haber producido nada no se
 * guarda ninguno, y "Reintentar" no deja el mensaje duplicado. Si la persona lo
 * detiene a medias, se guarda lo que hubiera. Las versiones que creó
 * `generar_diseno` quedan siempre: el visor ya las mostró.
 */

import { z } from "zod";
import { perfilActual, perfilConCad } from "@/lib/sesion";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { productosPorCodigo } from "@/lib/odoo/catalogos";
import type { Json } from "@/lib/supabase-tipos";
import {
  agregarMensaje,
  guardarVersionDiseno,
  listarMensajes,
  obtenerDiseno,
  obtenerMaterialDiseno,
  obtenerMaterialesPorCopia,
  obtenerVersionActual,
  renombrarSiPorDefecto,
  type HerramientaUsada,
} from "@/lib/cad/disenos-servidor";
import {
  ejecutarHerramienta,
  herramientasDisponibles,
  type DependenciasCad,
  type DependenciasLibre,
  type DisenoActual,
  type ResultadoHerramienta,
} from "@/lib/cad/herramientas";
import { generarDiseno, listarPlantillas, obtenerPlantilla } from "@/lib/cad/motor";
import { guardarVersionLibre, obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import {
  disenoLibreActivo,
  ejecutarCodigo,
  leerReferencia,
  listarReferencias,
  renderizar,
} from "@/lib/cad/sandbox";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { promptDeTurno } from "@/lib/cad/prompt";
import { NOMBRE_POR_DEFECTO, generarTitulo } from "@/lib/cad/titulo";
import { esquemaReferencias, mensajeConReferencias } from "@/lib/cad/caras";
import {
  ErrorLlm,
  LLM_NO_CONFIGURADO,
  llmConfigurado,
  transmitirChat,
  type LlamadaLlm,
  type MensajeLlm,
} from "@/lib/llm/inferhub";
import { serializarEvento, type EventoChat } from "@/components/disenos/chat-sse";

/**
 * Un turno puede encadenar varias llamadas al modelo y al motor CAD. Sin esto,
 * la plataforma corta la función a su tiempo por defecto, a media respuesta.
 */
export const maxDuration = 300;

/** Cuántas veces puede el modelo pedir herramientas en un turno antes de cortarlo. */
const MAX_VUELTAS = 8;
/** Con diseño libre hace falta más margen: generar → mirar el render → corregir. */
const MAX_VUELTAS_LIBRE = 16;

/** Cuántos mensajes anteriores se le reenvían al modelo. */
const MAX_HISTORIAL = 40;

const esquemaCuerpo = z.object({
  disenoId: z.uuid(),
  mensaje: z.string().trim().min(1).max(4000),
  /** Caras del visor 3D que la persona señaló con este mensaje. */
  referencias: esquemaReferencias.optional(),
});

function error(mensaje: string, status: number, codigo?: string) {
  return Response.json({ error: mensaje, ...(codigo ? { codigo } : {}) }, { status });
}

/** El diseño vigente, con el código si es libre. */
async function disenoActual(disenoId: string): Promise<DisenoActual | null> {
  const v = await obtenerVersionActual(disenoId);
  if (!v) return null;
  const base: DisenoActual = { plantilla: v.plantilla, parametros: v.parametros, version: v.version, origen: v.origen };
  if (v.plantilla !== PLANTILLA_LIBRE) return base;
  const libre = await obtenerVersionLibre(disenoId);
  return libre ? { ...base, codigo: libre.codigo, estado: libre.estado } : base;
}

/** El sandbox y las versiones libres, atados al diseño de esta conversación. */
function dependenciasLibre(disenoId: string): DependenciasLibre {
  // El GLB de la última ejecución que salió bien en este turno: `ver_render`
  // lo reutiliza en vez de volver a ejecutar el código.
  let ultimoGlb: string | null = null;
  return {
    ejecutarCodigo: async (codigo) => {
      const r = await ejecutarCodigo(codigo);
      ultimoGlb = r.glb_base64;
      return r;
    },
    guardarVersionLibre: (codigo) => guardarVersionLibre({ disenoId, codigo, origen: "chat" }),
    guardarVersionLibreConMaterial: (codigo, material, acomodo, materiales) =>
      guardarVersionLibre({
        disenoId,
        codigo,
        origen: "chat",
        material,
        acomodo: acomodo as unknown as Json,
        materiales,
      }),
    renderizarActual: async () => {
      const actual = await disenoActual(disenoId);
      if (actual?.plantilla === PLANTILLA_LIBRE && actual.codigo) {
        return ultimoGlb ? renderizar({ glb_base64: ultimoGlb }) : renderizar({ codigo: actual.codigo });
      }
      if (!actual) throw new Error("Sin diseño");
      const generado = await generarDiseno(actual.plantilla, actual.parametros);
      return renderizar({ glb_base64: generado.glb_base64 });
    },
    listarReferencias,
    leerReferencia,
    intentos: { n: 0 },
  };
}

/** Lo que cuesta cada plancha en Odoo, por su código. */
async function preciosDePlanchas(codigos: string[]): Promise<Record<string, number>> {
  const productos = await productosPorCodigo(codigos);
  return Object.fromEntries([...productos].map(([codigo, p]) => [codigo, p.precio]));
}

/**
 * El motor, la base y el catálogo de verdad, atados al diseño de esta
 * conversación. Los precios, solo si quien chatea es Administración.
 */
function dependencias(disenoId: string, libreActivo: boolean, conPrecios: boolean): DependenciasCad {
  return {
    listarPlantillas,
    obtenerPlantilla,
    generarDiseno,
    guardarVersion: ({ plantilla, parametros, versionPlantilla, material, acomodo, materiales }) =>
      guardarVersionDiseno({
        disenoId,
        plantilla,
        parametros,
        versionPlantilla,
        origen: "chat",
        material,
        acomodo: acomodo as unknown as Json,
        materiales,
      }),
    obtenerDisenoActual: () => disenoActual(disenoId),
    obtenerMaterial: () => obtenerMaterialDiseno(disenoId),
    obtenerMaterialesPorCopia: () => obtenerMaterialesPorCopia(disenoId),
    cargarPlanchas: () => cargarCatalogoPlanchas(true),
    cargarConfigCortes,
    ...(conPrecios ? { cargarPrecios: preciosDePlanchas } : {}),
    ...(libreActivo ? { libre: dependenciasLibre(disenoId) } : {}),
  };
}

export async function POST(request: Request) {
  const perfil = await perfilConCad();
  if (!perfil) {
    // Solo para decir cuál de las dos cosas pasó: sin sesión, o sin permiso.
    const actual = await perfilActual();
    return actual && !actual.debeCambiarPassword
      ? error("Tu rol no puede usar el asistente de diseños.", 403)
      : error("Tu sesión caducó. Recarga la página.", 401);
  }

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return error("No se pudo leer el mensaje.", 400);
  }
  const cuerpo = esquemaCuerpo.safeParse(crudo);
  if (!cuerpo.success) {
    const porCaras = cuerpo.error.issues.some((i) => i.path[0] === "referencias");
    return error(
      porCaras ? "Las caras señaladas no son válidas. Vuelve a señalarlas." : "Escribe un mensaje (hasta 4000 caracteres).",
      400,
    );
  }
  const { disenoId, mensaje } = cuerpo.data;
  const referencias = cuerpo.data.referencias ?? [];

  if (!llmConfigurado()) return error(LLM_NO_CONFIGURADO, 503, "llm_no_configurado");

  // El diseño libre (código en el sandbox) solo con la bandera y el sandbox configurado.
  const libreActivo = disenoLibreActivo();
  const herramientas = herramientasDisponibles(libreActivo);
  const maxVueltas = libreActivo ? MAX_VUELTAS_LIBRE : MAX_VUELTAS;

  let sistema: string;
  let mensajes: MensajeLlm[];
  /** Si este es el primer turno de un diseño que aún no tiene nombre. */
  let ponerTitulo = false;
  try {
    const diseno = await obtenerDiseno(disenoId);
    if (!diseno) {
      return error("El diseño ya no está disponible. Recarga la página.", 404);
    }
    // El diseño tal como está AHORA va en las instrucciones de cada turno: así
    // el asistente se entera de lo que se cambió en el formulario. Los turnos
    // anteriores se reenvían como texto, sin sus herramientas pero con las
    // caras que se señalaron (el modelo las lee como un bloque de texto).
    const [actual, historial] = await Promise.all([
      disenoActual(disenoId),
      listarMensajes(disenoId, MAX_HISTORIAL),
    ]);
    ponerTitulo = historial.length === 0 && diseno.nombre === NOMBRE_POR_DEFECTO;
    sistema = promptDeTurno(actual, { disenoLibre: libreActivo });
    mensajes = [
      ...historial
        .filter((m) => m.contenido.trim())
        .map((m): MensajeLlm => ({ rol: m.rol, contenido: mensajeConReferencias(m.contenido, m.referencias) })),
      { rol: "usuario", contenido: mensajeConReferencias(mensaje, referencias) },
    ];
  } catch (e) {
    console.error("[cad] chat: preparar el turno", e);
    return error("No se pudo abrir la conversación. Intenta de nuevo.", 500);
  }

  const deps = dependencias(disenoId, libreActivo, perfil.rol === "administracion");
  const inicio = new Date();

  // El título se pide a la vez que la respuesta, para no hacer esperar al
  // final del turno. Nunca falla: si el modelo no contesta, sale del mensaje.
  const titulo = ponerTitulo ? generarTitulo(mensaje) : null;

  // Dos formas de que quien escucha se vaya: la petición se aborta, o el
  // navegador cancela la lectura. Las dos cortan la llamada al modelo.
  const corte = new AbortController();
  if (request.signal.aborted) corte.abort();
  else request.signal.addEventListener("abort", () => corte.abort(), { once: true });

  const codificador = new TextEncoder();

  const flujo = new ReadableStream<Uint8Array>({
    async start(control) {
      let abierto = true;
      const emitir = (evento: EventoChat) => {
        if (!abierto || corte.signal.aborted) return;
        try {
          control.enqueue(codificador.encode(serializarEvento(evento)));
        } catch {
          abierto = false;
        }
      };

      let texto = "";
      const usadas: HerramientaUsada[] = [];
      const escribir = (delta: string) => {
        texto += delta;
        emitir({ tipo: "texto", delta });
      };

      try {
        for (let vuelta = 0; ; vuelta++) {
          let textoDeVuelta = "";
          const llamadas: (LlamadaLlm & { argumentosInvalidos?: string })[] = [];

          for await (const evento of transmitirChat({
            sistema,
            mensajes,
            herramientas,
            senal: corte.signal,
          })) {
            if (evento.tipo === "texto") {
              // Lo que escribe después de usar herramientas va en párrafo aparte.
              if (!textoDeVuelta && texto && !texto.endsWith("\n")) escribir("\n\n");
              textoDeVuelta += evento.delta;
              escribir(evento.delta);
            } else if (evento.tipo === "llamada_herramienta") {
              llamadas.push({
                id: evento.id,
                nombre: evento.nombre,
                argumentos: evento.argumentos,
                argumentosInvalidos: evento.argumentosInvalidos,
              });
            }
          }

          if (llamadas.length === 0) break;

          if (vuelta >= maxVueltas - 1) {
            if (texto && !texto.endsWith("\n")) escribir("\n\n");
            escribir("Me detuve porque este pedido me estaba tomando demasiados pasos. Dime cómo seguimos.");
            break;
          }

          mensajes.push({
            rol: "asistente",
            contenido: textoDeVuelta,
            llamadas: llamadas.map(({ id, nombre, argumentos }) => ({ id, nombre, argumentos })),
          });

          for (const llamada of llamadas) {
            if (corte.signal.aborted) break;
            emitir({ tipo: "herramienta", nombre: llamada.nombre, estado: "inicio" });

            const resultado: ResultadoHerramienta = llamada.argumentosInvalidos
              ? {
                  ok: false,
                  contenido: JSON.stringify({
                    error: {
                      codigo: "argumentos_invalidos",
                      mensaje: "Los argumentos no eran un objeto JSON válido. Vuelve a llamar con JSON correcto.",
                      recibido: llamada.argumentosInvalidos,
                    },
                  }),
                  resumen: "Argumentos inválidos",
                }
              : await ejecutarHerramienta(llamada.nombre, llamada.argumentos, deps);

            mensajes.push({
              rol: "herramienta",
              idLlamada: llamada.id,
              contenido: resultado.contenido,
              ...(resultado.imagenes?.length ? { imagenes: resultado.imagenes } : {}),
            });
            usadas.push({ nombre: llamada.nombre, ok: resultado.ok, resumen: resultado.resumen });
            emitir({
              tipo: "herramienta",
              nombre: llamada.nombre,
              estado: "fin",
              ok: resultado.ok,
              resumen: resultado.resumen,
            });
            if (resultado.diseno) emitir({ tipo: "diseno", ...resultado.diseno });
          }

          // Cortado a media tanda: al modelo no se le puede volver a llamar con
          // herramientas sin respuesta, y ya no hay nadie escuchando.
          if (corte.signal.aborted) break;
        }
      } catch (e) {
        if (!corte.signal.aborted) {
          if (e instanceof ErrorLlm) {
            // El detalle (estado, URL equivocada) es para quien configura.
            console.error(`[cad] chat: modelo (${e.codigo}${e.estado ? ` ${e.estado}` : ""})`, e.message);
            emitir({ tipo: "error", mensaje: e.message });
          } else {
            console.error("[cad] chat", e);
            emitir({ tipo: "error", mensaje: "El asistente falló. Intenta de nuevo." });
          }
        }
      }

      // Se guarda solo si el turno dejó algo: texto o herramientas usadas.
      const guardar = texto.trim() || usadas.length > 0;
      if (guardar) {
        try {
          await agregarMensaje({
            disenoId,
            rol: "usuario",
            contenido: mensaje,
            referencias,
            creadoEn: inicio.toISOString(),
          });
          await agregarMensaje({
            disenoId,
            rol: "asistente",
            contenido: texto.trim(),
            herramientas: usadas,
            // Siempre después del de la persona, aunque el turno durase menos de un milisegundo.
            creadoEn: new Date(Math.max(Date.now(), inicio.getTime() + 1)).toISOString(),
          });
        } catch (e) {
          console.error("[cad] chat: guardar la conversación", e);
          emitir({
            tipo: "error",
            mensaje: "La respuesta no se pudo guardar: al recargar no estará en la conversación.",
          });
        }
      }

      // El nombre, como el título de un chat de Claude: solo si el turno quedó
      // guardado (si no, el diseño sigue siendo un borrador sin tocar).
      if (titulo && guardar) {
        try {
          const nombre = await titulo;
          if (await renombrarSiPorDefecto(disenoId, nombre)) emitir({ tipo: "nombre", nombre });
        } catch (e) {
          console.error("[cad] chat: poner el nombre", e);
        }
      }

      emitir({ tipo: "fin" });
      abierto = false;
      try {
        control.close();
      } catch {
        // Ya lo cerró el navegador.
      }
    },
    cancel() {
      corte.abort();
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Que ningún proxy intermedio junte los trozos antes de entregarlos.
      "X-Accel-Buffering": "no",
    },
  });
}
