/**
 * Un motor CAD de mentira para las pruebas, como `odoo-falso.mts` para Odoo.
 *
 * Habla lo justo de la API que usa `lib/cad/motor.ts`:
 *   GET  /plantillas            las plantillas con que el catálogo dibuja sus productos
 *   GET  /plantillas/<codigo>   una de ellas (404 si no existe)
 *   POST /generar               { plantilla, parametros } → el modelo y su despiece
 *
 * El despiece de una caja sale de verdad de sus medidas (base, frente y fondo,
 * laterales y tapa); el resto, una sola pieza con las medidas que se pidan. El
 * GLB es siempre la misma caja chica: el visor lo pinta y las pruebas no miran
 * la geometría.
 *
 * Solo sintaxis de TypeScript que se puede borrar: Node lo corre tal cual
 * (`node e2e/cad-falso.mts`).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

type Valor = number | boolean | string;
type Parametros = Record<string, Valor>;

const numero = (titulo: string, porDefecto: number, minimo = 1, maximo = 3000) => ({
  type: "number",
  title: titulo,
  default: porDefecto,
  minimum: minimo,
  maximum: maximo,
});
const interruptor = (titulo: string, porDefecto = false) => ({ type: "boolean", title: titulo, default: porDefecto });

const ESPESOR = { espesor: numero("Espesor (mm)", 3, 1, 20) };

/** Las plantillas que usa el catálogo (`supabase/migrations/20261119000100_terminados_cad.sql`). */
const PLANTILLAS = [
  {
    codigo: "caja",
    nombre: "Caja",
    familia: "cajas",
    descripcion: "Caja de cinco caras, con o sin tapa.",
    esquema: {
      largo: numero("Largo (mm)", 200),
      ancho: numero("Ancho (mm)", 150),
      alto: numero("Alto (mm)", 100),
      ...ESPESOR,
      con_tapa: interruptor("Con tapa"),
      tipo_tapa: { type: "string", title: "Tapa", enum: ["a_ras", "con_pestana"], default: "a_ras" },
      ranura: { type: "string", title: "Ranura", enum: ["ninguna", "tapa", "frente"], default: "ninguna" },
    },
  },
  {
    codigo: "anfora",
    nombre: "Ánfora",
    familia: "anforas",
    descripcion: "Urna con ranura.",
    esquema: { largo: numero("Largo (mm)", 300), ancho: numero("Ancho (mm)", 300), alto: numero("Alto (mm)", 400), ...ESPESOR },
  },
  {
    codigo: "display",
    nombre: "Display",
    familia: "displays",
    descripcion: "Display de niveles.",
    esquema: { ancho: numero("Ancho (mm)", 300), fondo: numero("Fondo (mm)", 200), alto: numero("Alto (mm)", 300), ...ESPESOR },
  },
  {
    codigo: "porta_afiche",
    nombre: "Porta afiche",
    familia: "porta_afiches",
    descripcion: "Porta afiche de mostrador.",
    esquema: { ancho: numero("Ancho (mm)", 210), alto: numero("Alto (mm)", 297), fondo: numero("Fondo (mm)", 80), ...ESPESOR },
  },
  {
    codigo: "alzador",
    nombre: "Alzador",
    familia: "alzadores",
    descripcion: "Escalón para exhibir.",
    esquema: { largo: numero("Largo (mm)", 300), ancho: numero("Ancho (mm)", 200), alto: numero("Alto (mm)", 150), ...ESPESOR },
  },
  {
    codigo: "atril",
    nombre: "Atril",
    familia: "atriles",
    descripcion: "Atril de mesa.",
    esquema: { ancho: numero("Ancho (mm)", 400), alto: numero("Alto (mm)", 500), ...ESPESOR },
  },
  {
    codigo: "tareco",
    nombre: "Tareco",
    familia: "tarecos",
    descripcion: "Tareco de mesa.",
    esquema: { largo: numero("Largo (mm)", 200), alto: numero("Alto (mm)", 100), ...ESPESOR },
  },
  {
    codigo: "letrero",
    nombre: "Letrero",
    familia: "letreros",
    descripcion: "Letrero de pared.",
    esquema: { ancho: numero("Ancho (mm)", 600), alto: numero("Alto (mm)", 300), ...ESPESOR },
  },
  {
    codigo: "letras",
    nombre: "Letras",
    familia: "letras",
    descripcion: "Letras corpóreas.",
    esquema: { alto_letra: numero("Alto de letra (mm)", 150), texto: { type: "string", title: "Texto", default: "ABC" }, ...ESPESOR },
  },
].map((p) => ({ ...p, version: 1, esquema: { type: "object", properties: p.esquema, required: [] as string[] } }));

/** Una caja de 300 × 200 × 200 mm, en metros, Y arriba: lo único que pinta el visor. */
const GLB =
  "Z2xURgIAAACsAgAA6AEAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAifSwic2NlbmUiOjAsInNjZW5lcyI6W3sibm9kZXMiOlswXX1dLCJub2RlcyI6W3sibmFtZSI6ImJhc2UiLCJtZXNoIjowfV0sIm1lc2hlcyI6W3sicHJpbWl0aXZlcyI6W3siYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MH0sImluZGljZXMiOjF9XX1dLCJhY2Nlc3NvcnMiOlt7ImJ1ZmZlclZpZXciOjAsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo4LCJ0eXBlIjoiVkVDMyIsIm1pbiI6Wy0wLjE1LDAsLTAuMV0sIm1heCI6WzAuMTUsMC4yLDAuMV19LHsiYnVmZmVyVmlldyI6MSwiY29tcG9uZW50VHlwZSI6NTEyMywiY291bnQiOjM2LCJ0eXBlIjoiU0NBTEFSIn1dLCJidWZmZXJWaWV3cyI6W3siYnVmZmVyIjowLCJieXRlT2Zmc2V0IjowLCJieXRlTGVuZ3RoIjo5Nn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjk2LCJieXRlTGVuZ3RoIjo3Mn1dLCJidWZmZXJzIjpbeyJieXRlTGVuZ3RoIjoxNjh9XX0gIKgAAABCSU4AmpkZvgAAAADNzMy9mpkZvgAAAADNzMw9mpkZvs3MTD7NzMy9mpkZvs3MTD7NzMw9mpkZPgAAAADNzMy9mpkZPgAAAADNzMw9mpkZPs3MTD7NzMy9mpkZPs3MTD7NzMw9AAABAAMAAAADAAIABAAGAAcABAAHAAUAAAAEAAUAAAAFAAEAAgADAAcAAgAHAAYAAAACAAYAAAAGAAQAAQAFAAcAAQAHAAMA";

const n = (v: Valor | undefined, porDefecto: number) => (typeof v === "number" && v > 0 ? v : porDefecto);

function pieza(id: string, nombre: string, cantidad: number, espesor: number, ancho: number, alto: number) {
  return {
    id,
    nombre,
    cantidad,
    espesor_mm: espesor,
    ancho_mm: ancho,
    alto_mm: alto,
    area_mm2: ancho * alto,
    perimetro_mm: 2 * (ancho + alto),
  };
}

/** El despiece: el de una caja de verdad; para lo demás, una lámina con sus medidas. */
function despiece(plantilla: string, p: Parametros) {
  const e = n(p.espesor, 3);
  if (plantilla === "caja" || plantilla === "anfora" || plantilla === "alzador") {
    const largo = n(p.largo, 200);
    const ancho = n(p.ancho, 150);
    const alto = n(p.alto, 100);
    const piezas = [
      pieza("base", "Base", 1, e, largo, ancho),
      pieza("frente", "Frente y fondo", 2, e, largo, alto - e),
      pieza("lateral", "Laterales", 2, e, ancho - 2 * e, alto - e),
    ];
    if (plantilla !== "caja" || p.con_tapa === true) piezas.push(pieza("tapa", "Tapa", 1, e, largo, ancho));
    return { piezas, dimensiones: { x: largo, y: ancho, z: alto } };
  }
  const ancho = n(p.ancho ?? p.largo, 300);
  const alto = n(p.alto ?? p.alto_letra, 200);
  return { piezas: [pieza("lamina", "Lámina", 1, e, ancho, alto)], dimensiones: { x: ancho, y: n(p.fondo, e), z: alto } };
}

function json(res: ServerResponse, estado: number, cuerpo: unknown) {
  res.writeHead(estado, { "Content-Type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

async function leer(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(parte as Buffer);
  return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
}

export async function crearCadFalso(opciones: { puerto?: number } = {}) {
  const servidor = createServer(async (req, res) => {
    try {
      const ruta = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && ruta === "/__estado") return json(res, 200, { ok: true });
      if (req.method === "GET" && ruta === "/plantillas") return json(res, 200, PLANTILLAS);
      if (req.method === "GET" && ruta.startsWith("/plantillas/")) {
        const p = PLANTILLAS.find((x) => x.codigo === decodeURIComponent(ruta.slice("/plantillas/".length)));
        return p ? json(res, 200, p) : json(res, 404, { detail: "Not Found" });
      }
      if (req.method === "POST" && ruta === "/generar") {
        const { plantilla, parametros } = (await leer(req)) as { plantilla?: string; parametros?: Parametros };
        const p = PLANTILLAS.find((x) => x.codigo === plantilla);
        if (!p) return json(res, 404, { detail: { codigo: "plantilla", mensaje: `No existe la plantilla «${plantilla}».` } });
        // Lo que no se manda toma el valor por defecto, como en el motor de verdad.
        const completos: Parametros = { ...Object.fromEntries(Object.entries(p.esquema.properties).map(([k, v]) => [k, v.default as Valor])), ...parametros };
        const { piezas, dimensiones } = despiece(p.codigo, completos);
        return json(res, 200, {
          plantilla: p.codigo,
          version_plantilla: p.version,
          parametros: completos,
          dimensiones,
          glb_base64: GLB,
          piezas,
          validaciones: [],
        });
      }
      json(res, 404, { detail: "Not Found" });
    } catch (e) {
      json(res, 500, { detail: e instanceof Error ? e.message : "Error del motor falso." });
    }
  });
  await new Promise<void>((resolver) => servidor.listen(opciones.puerto ?? 0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
  return { url: `http://127.0.0.1:${puerto}`, cerrar: () => new Promise<void>((r) => servidor.close(() => r())) };
}

// `node e2e/cad-falso.mts`: lo arranca Playwright antes que la app.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cad = await crearCadFalso({ puerto: Number(process.env.CAD_FALSO_PUERTO ?? 8091) });
  console.log(`Motor CAD falso en ${cad.url}`);
}
