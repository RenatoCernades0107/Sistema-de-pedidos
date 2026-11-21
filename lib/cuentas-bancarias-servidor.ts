import { clienteServidor } from "./supabase-servidor";
import type { CuentaBancaria, MonedaCuenta, TipoCuenta } from "./cuentas-bancarias";

/**
 * Todas las cuentas, también las retiradas: la lista es además el registro de
 * quién agregó y quién quitó cada una. Las más nuevas primero. Solo
 * Administración las lee (RLS).
 */
export async function cargarCuentasBancarias(): Promise<CuentaBancaria[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cuentas_bancarias")
    .select(
      `id, banco, tipo, moneda, numero, cci, creada_en, vigente_desde, retirada_en,
       creador:usuarios!cuentas_bancarias_creada_por_fkey ( nombre ),
       retirador:usuarios!cuentas_bancarias_retirada_por_fkey ( nombre )`,
    )
    .order("creada_en", { ascending: false });
  if (error) throw new Error(`No se pudieron leer las cuentas bancarias: ${error.message}`);

  return (data ?? []).map((f) => ({
    id: f.id,
    banco: f.banco,
    tipo: f.tipo as TipoCuenta,
    moneda: f.moneda as MonedaCuenta,
    numero: f.numero,
    cci: f.cci,
    creadaEn: f.creada_en,
    creadaPor: f.creador?.nombre ?? "—",
    vigenteDesde: f.vigente_desde,
    retiradaEn: f.retirada_en,
    retiradaPor: f.retirada_en ? (f.retirador?.nombre ?? "—") : null,
  }));
}
