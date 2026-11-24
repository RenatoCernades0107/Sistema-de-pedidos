/**
 * Corre una prueba de cálculo contra lo real: el catálogo y la configuración
 * de la base, el motor CAD y los precios de Odoo. Lo que falle (el motor
 * caído, Odoo sin responder, un producto que ya no está) vuelve como error de
 * la prueba, no como excepción: la pantalla lo muestra en su tarjeta.
 *
 * Solo para Administración: lo exigen quienes llaman.
 */

import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { ErrorMotorCad, generarDiseno, motorConfigurado } from "@/lib/cad/motor";
import { productosPorCodigo } from "@/lib/odoo/catalogos";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";
import { cargarCatalogoTerminados } from "@/lib/terminados-servidor";
import { clienteServidor } from "@/lib/supabase-servidor";
import {
  CLAVE_PRUEBAS_CALCULO,
  armarResultado,
  leerPruebasGuardadas,
  resolverCaso,
  type CasoPrueba,
  type Ejecucion,
  type PruebasGuardadas,
} from "./prueba";

export async function ejecutarPrueba(caso: CasoPrueba): Promise<Ejecucion> {
  if (!motorConfigurado()) return { ok: false, error: "El motor CAD no está configurado en el servidor (CAD_API_BASE_URL)." };
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };

  try {
    const [catalogo, grupos, config] = await Promise.all([
      cargarCatalogoTerminados(),
      cargarCatalogoPlanchas(true),
      cargarConfigCortes(),
    ]);
    const r = resolverCaso(caso, catalogo, grupos);
    if (!r.ok) return r;

    let precios: Record<string, number>;
    try {
      const productos = await productosPorCodigo(grupos.flatMap((g) => g.formatos.map((f) => f.codigo)));
      precios = Object.fromEntries([...productos].map(([codigo, p]) => [codigo, p.precio]));
    } catch (e) {
      console.error("[pruebas-calculo] precios de Odoo", e);
      return {
        ok: false,
        error: e instanceof ErrorOdoo ? `Odoo: ${e.message}` : "No se pudieron leer los precios de Odoo.",
      };
    }

    const generacion = await generarDiseno(caso.tipo, r.resuelto.parametros);
    return {
      ok: true,
      resultado: armarResultado({ caso, resuelto: r.resuelto, generacion, catalogo: grupos, config, precios }),
    };
  } catch (e) {
    if (e instanceof ErrorMotorCad) {
      const campos = e.errores?.map((x) => `${x.campo}: ${x.mensaje}`).join("; ");
      return { ok: false, error: `Motor CAD: ${e.message}${campos ? ` (${campos})` : ""}` };
    }
    console.error("[pruebas-calculo]", e);
    return { ok: false, error: "La prueba falló de forma inesperada. Revisa el registro del servidor." };
  }
}

/** Los resultados aprobados de cada tipo (`configuracion.pruebas_calculo`). */
export async function cargarPruebasGuardadas(): Promise<PruebasGuardadas> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("configuracion")
    .select("valor")
    .eq("clave", CLAVE_PRUEBAS_CALCULO)
    .maybeSingle();
  return leerPruebasGuardadas(data?.valor ?? null);
}
