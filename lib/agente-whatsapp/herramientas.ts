/**
 * Las herramientas del agente: cómo se describen al modelo y cómo se ejecutan.
 *
 * No leen la base ni Odoo directamente: reciben un `ContextoHerramientas` que
 * sí lo hace (`contexto-servidor.ts`). Así el motor se prueba con datos falsos y
 * el mismo agente sirve para el área de pruebas y para el webhook de WhatsApp.
 */

import type { HerramientaLlm } from "@/lib/llm/inferhub";
import type { ResultadoPrecios } from "./precios";
import { TIPOS_DOCUMENTO, esTipoDocumento, type AdjuntoAgente, type PasoTraza, type TipoDocumento } from "./tipos";

export interface FragmentoEncontrado {
  documentoId: string;
  documento: string;
  tipo: TipoDocumento;
  pagina: number | null;
  contenido: string;
  /** Si ese documento se le puede mandar al cliente. */
  enviable: boolean;
}

export interface CuentaAgente {
  banco: string;
  tipo: string;
  moneda: string;
  numero: string;
  cci: string | null;
}

export interface DatosEmpresaAgente {
  direccion: string;
  referencia: string;
  distrito: string;
  mapsUrl: string;
  horario: string;
  telefono: string;
  cuentas: CuentaAgente[];
}

export interface ArchivoEnviable extends AdjuntoAgente {
  descripcion: string;
}

export interface ContextoHerramientas {
  buscarPrecios(consulta: string): Promise<ResultadoPrecios>;
  buscarInformacion(consulta: string): Promise<FragmentoEncontrado[]>;
  datosEmpresa(): Promise<DatosEmpresaAgente>;
  /** Los archivos que se pueden mandar, listos y marcados como enviables. */
  archivosEnviables(): Promise<ArchivoEnviable[]>;
}

export const HERRAMIENTAS_AGENTE: HerramientaLlm[] = [
  {
    nombre: "buscar_precios",
    descripcion:
      "Busca el precio de venta de planchas (acrílico, policarbonato, etc.) y accesorios en la lista de precios vigente. " +
      "Escribe la consulta con material, color, espesor y medida si los sabes (ej.: 'acrílico cristal 3mm'). " +
      "Devuelve producto, código, medida, espesor y precio en soles por unidad.",
    parametros: {
      type: "object",
      properties: { consulta: { type: "string", description: "Qué producto busca el cliente." } },
      required: ["consulta"],
    },
  },
  {
    nombre: "buscar_informacion",
    descripcion:
      "Busca en los catálogos, fichas técnicas y fotos de la empresa: características, usos, colores disponibles, " +
      "propiedades técnicas, servicios. Devuelve fragmentos con el documento y la página de donde salen.",
    parametros: {
      type: "object",
      properties: { consulta: { type: "string", description: "La pregunta o el tema, en pocas palabras." } },
      required: ["consulta"],
    },
  },
  {
    nombre: "datos_empresa",
    descripcion:
      "La dirección de la tienda (con referencia y enlace de Google Maps), el horario de atención, el teléfono y las cuentas bancarias para pagar.",
    parametros: { type: "object", properties: {} },
  },
  {
    nombre: "listar_archivos",
    descripcion: "Lista las fotos, catálogos y fichas técnicas que se le pueden enviar al cliente, con su id y descripción.",
    parametros: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: Object.keys(TIPOS_DOCUMENTO),
          description: "Opcional: solo de este tipo.",
        },
      },
    },
  },
  {
    nombre: "enviar_archivo",
    descripcion:
      "Envía al cliente una foto, catálogo o ficha técnica (por su id, de listar_archivos o buscar_informacion). " +
      "Se envía después de tu mensaje de texto. Úsalo solo si el cliente lo pidió o si de verdad le ayuda.",
    parametros: {
      type: "object",
      properties: {
        documento_id: { type: "string", description: "El id del archivo." },
        texto: { type: "string", description: "Opcional: un pie corto para el archivo." },
      },
      required: ["documento_id"],
    },
  },
  {
    nombre: "derivar_a_asesor",
    descripcion:
      "Pasa la conversación a una persona del equipo cuando no puedes responder con certeza: cotizar cortes o productos " +
      "terminados, pedidos, pagos, stock, plazos, reclamos, adjuntos que no entiendes, o cuando lo pide el cliente. " +
      "Después de llamarla NO escribas nada: el cliente no recibe mensaje tuyo y lo atiende un asesor.",
    parametros: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description: "Por qué: 'cotizar corte', 'cotizar producto terminado', 'tomar pedido', 'lo pidió el cliente', 'no sé la respuesta'…",
        },
      },
      required: ["motivo"],
    },
  },
];

/** Lo que pasó al ejecutar una herramienta. */
export interface ResultadoHerramienta {
  /** Lo que vuelve al modelo (JSON o texto). */
  contenido: string;
  paso: PasoTraza;
  adjunto?: { adjunto: AdjuntoAgente; texto?: string };
  derivar?: { motivo: string };
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Recorta textos largos para la traza que se guarda. */
const corto = (s: string, max = 400) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const json = (v: unknown) => JSON.stringify(v);

/**
 * Ejecuta una herramienta. Nunca lanza: un error vuelve al modelo como texto,
 * para que se disculpe o lo intente de otra forma.
 */
export async function ejecutarHerramienta(
  nombre: string,
  argumentos: Record<string, unknown>,
  contexto: ContextoHerramientas,
): Promise<ResultadoHerramienta> {
  const paso = (resumen: string, detalle?: unknown, error = false): PasoTraza => ({
    herramienta: nombre,
    argumentos,
    resumen,
    detalle,
    error,
  });
  try {
    switch (nombre) {
      case "buscar_precios": {
        const consulta = texto(argumentos.consulta);
        if (!consulta) return { contenido: "Falta la consulta.", paso: paso("Sin consulta", undefined, true) };
        const r = await contexto.buscarPrecios(consulta);
        if (r.encontrados.length === 0) {
          return {
            contenido: json({ encontrados: [], nota: "No hay productos con precio que coincidan. Pide más detalles o deriva." }),
            paso: paso("Ningún precio encontrado"),
          };
        }
        return {
          contenido: json({
            encontrados: r.encontrados,
            moneda: "PEN",
            ...(r.mas > 0 ? { nota: `Hay ${r.mas} productos más que coinciden: pide que precise.` } : {}),
          }),
          paso: paso(
            `${r.encontrados.length} ${r.encontrados.length === 1 ? "precio" : "precios"}${r.mas ? ` (+${r.mas})` : ""}`,
            r.encontrados,
          ),
        };
      }

      case "buscar_informacion": {
        const consulta = texto(argumentos.consulta);
        if (!consulta) return { contenido: "Falta la consulta.", paso: paso("Sin consulta", undefined, true) };
        const fragmentos = await contexto.buscarInformacion(consulta);
        if (fragmentos.length === 0) {
          return {
            contenido: json({ fragmentos: [], nota: "No hay nada sobre eso en los documentos. No lo inventes." }),
            paso: paso("Nada encontrado"),
          };
        }
        return {
          contenido: json({
            fragmentos: fragmentos.map((f) => ({
              documento_id: f.documentoId,
              documento: f.documento,
              tipo: TIPOS_DOCUMENTO[f.tipo],
              pagina: f.pagina,
              enviable: f.enviable,
              contenido: f.contenido,
            })),
          }),
          paso: paso(
            `${fragmentos.length} ${fragmentos.length === 1 ? "fragmento" : "fragmentos"} de ${new Set(fragmentos.map((f) => f.documento)).size} documento(s)`,
            fragmentos.map((f) => ({ documento: f.documento, pagina: f.pagina, contenido: corto(f.contenido) })),
          ),
        };
      }

      case "datos_empresa": {
        const d = await contexto.datosEmpresa();
        const faltan = [!d.direccion && "dirección", !d.horario && "horario", d.cuentas.length === 0 && "cuentas"].filter(
          Boolean,
        );
        return {
          contenido: json({
            ...d,
            ...(faltan.length ? { nota: `No están configurados: ${faltan.join(", ")}. No los inventes.` } : {}),
          }),
          paso: paso(
            `${d.direccion ? "Dirección" : "Sin dirección"} · ${d.cuentas.length} ${d.cuentas.length === 1 ? "cuenta" : "cuentas"}`,
            d,
          ),
        };
      }

      case "listar_archivos": {
        const tipo = esTipoDocumento(argumentos.tipo) ? argumentos.tipo : null;
        const archivos = (await contexto.archivosEnviables()).filter((a) => !tipo || a.tipo === tipo);
        return {
          contenido: json({
            archivos: archivos.map((a) => ({
              id: a.documentoId,
              nombre: a.nombre,
              tipo: TIPOS_DOCUMENTO[a.tipo],
              descripcion: corto(a.descripcion, 300),
            })),
          }),
          paso: paso(`${archivos.length} ${archivos.length === 1 ? "archivo" : "archivos"}`, archivos.map((a) => a.nombre)),
        };
      }

      case "enviar_archivo": {
        const id = texto(argumentos.documento_id);
        const archivo = (await contexto.archivosEnviables()).find((a) => a.documentoId === id);
        if (!archivo) {
          return {
            contenido: "Ese archivo no existe o no se puede enviar. Usa listar_archivos para ver los disponibles.",
            paso: paso("Archivo no disponible", { documento_id: id }, true),
          };
        }
        const pie = texto(argumentos.texto).slice(0, 1000) || undefined;
        const { descripcion, ...adjunto } = archivo;
        void descripcion;
        return {
          contenido: json({ enviado: archivo.nombre }),
          paso: paso(`Envía «${archivo.nombre}»`),
          adjunto: { adjunto, texto: pie },
        };
      }

      case "derivar_a_asesor": {
        const motivo = texto(argumentos.motivo) || "sin motivo";
        return {
          contenido: json({
            derivado: true,
            nota: "Listo: una persona del equipo atenderá al cliente. No escribas nada más; termina tu turno sin texto.",
          }),
          paso: paso(`Deriva a un asesor: ${motivo}`),
          derivar: { motivo },
        };
      }

      default:
        return { contenido: `La herramienta ${nombre} no existe.`, paso: paso("Herramienta desconocida", undefined, true) };
    }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error(`[agente-whatsapp] ${nombre}`, mensaje);
    return {
      contenido: `No se pudo consultar ahora (${corto(mensaje, 200)}). No inventes el dato: ofrece que un asesor lo confirme.`,
      paso: paso("Falló la consulta", corto(mensaje, 300), true),
    };
  }
}
