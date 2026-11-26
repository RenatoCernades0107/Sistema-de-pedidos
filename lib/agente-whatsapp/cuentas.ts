import { estadoCuenta, MONEDAS_CUENTA, TIPOS_CUENTA, type CuentaBancaria } from "@/lib/cuentas-bancarias";
import type { CuentaAgente } from "./herramientas";

/** Las cuentas que el agente comparte: vigentes (no pendientes ni retiradas) y marcadas para el PDF. */
export function cuentasParaAgente(cuentas: CuentaBancaria[], ahora = new Date()): CuentaAgente[] {
  return cuentas
    .filter((c) => c.enPdf && estadoCuenta(c, ahora) === "vigente")
    .map((c) => ({
      banco: c.banco,
      tipo: TIPOS_CUENTA[c.tipo],
      moneda: MONEDAS_CUENTA[c.moneda],
      numero: c.numero,
      cci: c.cci,
    }));
}
