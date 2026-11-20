import { clienteServidor } from "./supabase-servidor";
import {
  esquemaResumen,
  leerDatos,
  type BorradorAbierto,
  type BorradorListado,
  type DatosBorradorCotizacion,
  type DatosBorradorPedido,
  type TipoBorrador,
} from "./borradores";

/**
 * Los borradores de quien pide, vigentes, del más reciente al más viejo. La RLS
 * ya deja ver solo los propios; el filtro por `vence_en` esconde los que el job
 * de limpieza todavía no borró.
 */
export async function cargarBorradores(tipo: TipoBorrador): Promise<BorradorListado[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("borradores")
    .select("id, tipo, cotizacion_id, resumen, actualizado_en, vence_en")
    .eq("tipo", tipo)
    .gt("vence_en", new Date().toISOString())
    .order("actualizado_en", { ascending: false })
    .limit(50);
  // Sin borradores la lista sigue funcionando: no vale tumbar la página por esto.
  if (error || !data) return [];

  return data.map((b) => {
    const r = esquemaResumen.safeParse(b.resumen);
    return {
      id: b.id,
      tipo: b.tipo as TipoBorrador,
      cotizacionId: b.cotizacion_id,
      resumen: r.success ? r.data : { cliente: null, productos: 0, total: 0 },
      actualizadoEn: b.actualizado_en,
      venceEn: b.vence_en,
    };
  });
}

/**
 * Abre un borrador para retomarlo. Abrirlo cuenta como "entrar": el update
 * renueva las 48 h (lo hace el trigger de la tabla). `null` si no existe, no es
 * de quien pide, venció o ya no se puede leer.
 */
export async function abrirBorrador(id: string, tipo: "cotizacion"): Promise<BorradorAbierto<DatosBorradorCotizacion> | null>;
export async function abrirBorrador(id: string, tipo: "pedido"): Promise<BorradorAbierto<DatosBorradorPedido> | null>;
export async function abrirBorrador(id: string, tipo: TipoBorrador): Promise<BorradorAbierto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("borradores")
    .update({ vence_en: new Date().toISOString() })
    .eq("id", id)
    .eq("tipo", tipo)
    .gt("vence_en", new Date().toISOString())
    .select("id, cotizacion_id, datos")
    .maybeSingle();
  if (!data) return null;

  const datos = leerDatos(tipo, data.datos);
  if (!datos) return null;
  return { id: data.id, cotizacionId: data.cotizacion_id, datos };
}
