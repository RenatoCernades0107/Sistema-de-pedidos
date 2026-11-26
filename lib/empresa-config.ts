/**
 * Los datos de la empresa que Administración ajusta en `/configuracion` (pestaña
 * "Empresa"): dónde está la tienda, cómo llegar y cuándo atiende. Vive en la
 * fila `empresa` de la tabla `configuracion`; si no existe, todo va vacío.
 *
 * Hoy los lee el agente de WhatsApp para contestar "¿dónde están?". Son datos
 * generales a propósito: el día que el PDF o el seguimiento quieran la
 * dirección, la leen de aquí.
 */

import { z } from "zod";

export const CLAVE_CONFIG_EMPRESA = "empresa";

const texto = (max: number, nombre: string) =>
  z
    .string()
    .trim()
    .max(max, `${nombre} no puede pasar de ${max} caracteres`);

export const esquemaConfigEmpresa = z.object({
  direccion: texto(200, "La dirección"),
  referencia: texto(200, "La referencia"),
  distrito: texto(120, "El distrito"),
  mapsUrl: z
    .string()
    .trim()
    .max(500, "El enlace del mapa es demasiado largo")
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "El enlace del mapa tiene que empezar con https://"),
  horario: texto(300, "El horario"),
  telefono: texto(60, "El teléfono"),
});

export type ConfigEmpresa = z.infer<typeof esquemaConfigEmpresa>;

export const CONFIG_EMPRESA_VACIA: ConfigEmpresa = {
  direccion: "",
  referencia: "",
  distrito: "",
  mapsUrl: "",
  horario: "",
  telefono: "",
};

/** Lo guardado, campo por campo; lo que falte o no se entienda queda vacío. */
export function leerConfigEmpresa(json: unknown): ConfigEmpresa {
  const fuente = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const salida = { ...CONFIG_EMPRESA_VACIA };
  for (const clave of Object.keys(CONFIG_EMPRESA_VACIA) as (keyof ConfigEmpresa)[]) {
    const r = esquemaConfigEmpresa.shape[clave].safeParse(fuente[clave]);
    if (r.success) salida[clave] = r.data;
  }
  return salida;
}
