/**
 * El `ContextoHerramientas` de verdad: de dónde saca el agente cada dato.
 *
 *   Precios    → la Lista de precios (catálogo de planchas y accesorios + precio de Odoo).
 *   Documentos → la base de conocimiento (`conocimiento-servidor.ts`).
 *   Empresa    → Configuración › Empresa + las cuentas bancarias vigentes que salen en el PDF.
 *
 * Cada fuente se lee una vez por respuesta, aunque el modelo pregunte varias veces.
 */

import { cache } from "react";
import { cargarCuentasBancarias } from "@/lib/cuentas-bancarias-servidor";
import { cargarConfigEmpresa } from "@/lib/empresa-servidor";
import { cargarConfigListaPrecios, cargarDatosListaPrecios } from "@/lib/lista-precios-servidor";
import { clienteServidor } from "@/lib/supabase-servidor";
import { CLAVE_AJUSTES_AGENTE, leerAjustesAgente, type AjustesAgente } from "./ajustes";
import { buscarEnConocimiento, cargarArchivosEnviables } from "./conocimiento-servidor";
import { cuentasParaAgente } from "./cuentas";
import type { ContextoHerramientas } from "./herramientas";
import { buscarPrecios } from "./precios";

/** Lo que Administración ajustó del agente, con los defectos. */
export const cargarAjustesAgente = cache(async (): Promise<AjustesAgente> => {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("configuracion").select("valor").eq("clave", CLAVE_AJUSTES_AGENTE).maybeSingle();
  return leerAjustesAgente(data?.valor ?? null);
});

/** La nota de la lista de precios ("Los precios incluyen IGV."), o nada si no se puede leer. */
export async function notaDePrecios(): Promise<string | undefined> {
  try {
    return (await cargarConfigListaPrecios()).notaPie;
  } catch {
    return undefined;
  }
}

/** Una vez por respuesta: si falla, el siguiente intento vuelve a probar. */
export function unaVez<T>(cargar: () => Promise<T>): () => Promise<T> {
  let promesa: Promise<T> | null = null;
  return () => {
    promesa ??= cargar().catch((e) => {
      promesa = null;
      throw e;
    });
    return promesa;
  };
}

export function contextoDelServidor(): ContextoHerramientas {
  const lista = unaVez(cargarDatosListaPrecios);
  const archivos = unaVez(cargarArchivosEnviables);
  return {
    buscarPrecios: async (consulta) => buscarPrecios(await lista(), consulta),
    buscarInformacion: (consulta) => buscarEnConocimiento(consulta),
    archivosEnviables: archivos,
    datosEmpresa: async () => {
      const [empresa, cuentas] = await Promise.all([cargarConfigEmpresa(), cargarCuentasBancarias()]);
      return { ...empresa, cuentas: cuentasParaAgente(cuentas) };
    },
  };
}

