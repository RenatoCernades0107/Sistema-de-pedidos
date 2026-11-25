import { cache } from "react";
import { clienteServidor } from "./supabase-servidor";
import { CLAVE_CONFIG_EMPRESA, leerConfigEmpresa, type ConfigEmpresa } from "./empresa-config";

/** La dirección, el horario y el teléfono de la empresa, con los vacíos por defecto. */
export const cargarConfigEmpresa = cache(async (): Promise<ConfigEmpresa> => {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("configuracion").select("valor").eq("clave", CLAVE_CONFIG_EMPRESA).maybeSingle();
  return leerConfigEmpresa(data?.valor ?? null);
});
