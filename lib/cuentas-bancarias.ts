/**
 * Las cuentas bancarias que salen en el PDF de la cotización.
 *
 * Las reglas de seguridad viven en la base (`20261210000100_cuentas_bancarias.sql`):
 * no se editan, una nueva espera 24 horas antes de salir en un PDF, solo se
 * escriben con la clave del servidor y Administración recibe un aviso de cada
 * cambio. Aquí solo está lo que se valida en el formulario y cómo se escriben.
 */

import { z } from "zod";

export const TIPOS_CUENTA = {
  corriente: "Cuenta corriente",
  ahorros: "Cuenta de ahorros",
  detracciones: "Cuenta de detracciones",
} as const;

export const MONEDAS_CUENTA = {
  PEN: "Soles",
  USD: "Dólares",
} as const;

export type TipoCuenta = keyof typeof TIPOS_CUENTA;
export type MonedaCuenta = keyof typeof MONEDAS_CUENTA;

/** Lo que sale en el PDF. */
export interface CuentaParaPdf {
  banco: string;
  tipo: TipoCuenta;
  moneda: MonedaCuenta;
  numero: string;
  cci: string | null;
}

/** Lo que ve Administración en `/configuracion`. */
export interface CuentaBancaria extends CuentaParaPdf {
  id: string;
  creadaEn: string;
  creadaPor: string;
  vigenteDesde: string;
  retiradaEn: string | null;
  retiradaPor: string | null;
}

/** Sin espacios ni puntos: "191 1234567 0 12" y "191.1234567.0.12" se guardan con guiones. */
export const normalizarNumero = (s: string) =>
  s
    .trim()
    .replace(/[\s.]+/g, "-")
    .replace(/-{2,}/g, "-");

/** El CCI va pegado: se le quitan los espacios y guiones con que lo copian del banco. */
export const normalizarCci = (s: string) => s.replace(/[\s-]/g, "");

export const esquemaCuentaBancaria = z
  .object({
    banco: z.string().trim().min(2, "Escribe el nombre del banco").max(60, "El nombre del banco es muy largo"),
    tipo: z.enum(Object.keys(TIPOS_CUENTA) as [TipoCuenta, ...TipoCuenta[]], "Elige el tipo de cuenta"),
    moneda: z.enum(Object.keys(MONEDAS_CUENTA) as [MonedaCuenta, ...MonedaCuenta[]], "Elige la moneda"),
    numero: z
      .string()
      .transform(normalizarNumero)
      .pipe(
        z
          .string()
          .regex(/^[0-9][0-9-]{4,28}[0-9]$/, "El número de cuenta lleva solo dígitos y guiones (de 6 a 30 caracteres)"),
      ),
    cci: z
      .string()
      .transform(normalizarCci)
      .pipe(z.string().regex(/^([0-9]{20})?$/, "El CCI tiene 20 dígitos")),
  })
  .refine((c) => c.cci !== "" || c.tipo === "detracciones", {
    message: "Falta el CCI (20 dígitos). Solo la cuenta de detracciones puede ir sin él.",
    path: ["cci"],
  });

export type EntradaCuentaBancaria = z.input<typeof esquemaCuentaBancaria>;

/** "Pendiente", "Vigente" o "Retirada", según la hora. */
export function estadoCuenta(c: Pick<CuentaBancaria, "vigenteDesde" | "retiradaEn">, ahora = new Date()) {
  if (c.retiradaEn) return "retirada" as const;
  return new Date(c.vigenteDesde) <= ahora ? ("vigente" as const) : ("pendiente" as const);
}

/** "BCP · Cuenta corriente · Soles" */
export const tituloCuenta = (c: Pick<CuentaParaPdf, "banco" | "tipo" | "moneda">) =>
  `${c.banco} · ${TIPOS_CUENTA[c.tipo]} · ${MONEDAS_CUENTA[c.moneda]}`;

/** Lo que manda `cotizacion_publica()`, filtrando lo que no se entienda: al PDF solo llega una cuenta completa. */
export function leerCuentasPublicas(json: unknown): CuentaParaPdf[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x): CuentaParaPdf[] => {
    if (!x || typeof x !== "object") return [];
    const c = x as Record<string, unknown>;
    if (typeof c.banco !== "string" || typeof c.numero !== "string") return [];
    if (!(typeof c.tipo === "string" && c.tipo in TIPOS_CUENTA)) return [];
    if (!(typeof c.moneda === "string" && c.moneda in MONEDAS_CUENTA)) return [];
    return [
      {
        banco: c.banco,
        tipo: c.tipo as TipoCuenta,
        moneda: c.moneda as MonedaCuenta,
        numero: c.numero,
        cci: typeof c.cci === "string" && c.cci ? c.cci : null,
      },
    ];
  });
}
