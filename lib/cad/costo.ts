/**
 * Lo que cuesta fabricar un diseño: el material y el corte láser. Nada más —sin
 * plegado ni armado—: el precio al cliente lo fija una persona a partir de aquí.
 *
 * - Material: el formato que eligió el acomodo real (`lib/cad/acomodo.ts`),
 *   cobrado con las mismas reglas que un corte a medida (`calcularCorte`:
 *   fracciones de plancha, recargo) y el precio de Odoo de esa plancha.
 * - Láser: con el perímetro real de cada pieza que midió el motor
 *   (`tiempoLaserPorPerimetro`), no el de su caja envolvente.
 *
 * Puro: corre igual en el navegador y en el servidor.
 */

import { calcularCorte, type FormatoCorte } from "@/lib/cortes/calcular";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { tiempoLaserPorPerimetro } from "@/lib/cortes/laser";
import type { ResultadoAcomodo } from "./acomodo";
import type { PiezaCad } from "./tipos";

export interface CostoDiseno {
  /** La plancha con la que se calculó. */
  formato: FormatoCorte;
  planchas: number;
  /** Lo que se cobra por el material (planchas o fracciones, con recargo). */
  material: number;
  minutosLaser: number;
  /** El corte láser, con IGV si la configuración lo suma. */
  servicio: number;
  total: number;
  /** Si el costo no se puede usar tal cual, por qué. */
  problema: string | null;
}

export interface EntradaCostoDiseno {
  piezas: PiezaCad[];
  grupo: Pick<GrupoPlancha, "formatos" | "espesorMm" | "rotable">;
  /** El acomodo del diseño en el grupo: dice qué formato se usa. */
  acomodo: Pick<ResultadoAcomodo, "formatoId" | "noCaben"> | null;
  /** Precio de cada plancha en Odoo, por su código. */
  precios: ReadonlyMap<string, number> | Record<string, number>;
  config: ConfigCortes;
}

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function precioDe(
  precios: EntradaCostoDiseno["precios"],
  codigo: string,
): number | undefined {
  return precios instanceof Map
    ? precios.get(codigo)
    : (precios as Record<string, number>)[codigo];
}

/** `null` si falta el acomodo o el formato ya no está en el grupo. */
export function costoDiseno(e: EntradaCostoDiseno): CostoDiseno | null {
  if (!e.acomodo || e.piezas.length === 0) return null;
  const f = e.grupo.formatos.find((x) => x.id === e.acomodo!.formatoId);
  if (!f) return null;

  const precio = precioDe(e.precios, f.codigo);
  const formato: FormatoCorte = {
    codigo: f.codigo,
    ancho: f.anchoCm,
    alto: f.largoCm,
    precio: precio ?? 0,
  };

  // El material, con las reglas de cobro de un corte a medida. El corte manual
  // no paga láser: el servicio de `calcularCorte` se descarta y se rehace abajo.
  const corte = calcularCorte(
    {
      piezas: e.piezas.map((p) => ({
        ancho: p.ancho_mm / 10,
        alto: p.alto_mm / 10,
        cantidad: p.cantidad,
      })),
      espesorMm: e.grupo.espesorMm,
      modalidad: "laser",
      rotable: e.grupo.rotable,
    },
    formato,
    e.config,
  );

  const laser = tiempoLaserPorPerimetro(
    e.piezas.map((p) => ({
      perimetroMm: p.perimetro_mm,
      cantidad: p.cantidad,
    })),
    e.grupo.espesorMm,
    e.config.laser,
  );
  const material = corte.material;
  const servicioBruto = laser.costo * (1 + e.config.laser.igvPct / 100);
  const suma = material + servicioBruto;
  const total = e.config.cobro.redondearAlSol
    ? Math.ceil(suma - 1e-9)
    : redondear2(suma);

  let problema = corte.problema;
  if (precio === undefined)
    problema = `La plancha ${f.codigo} no tiene precio en Odoo: el material sale en cero.`;
  else if (e.acomodo.noCaben.length > 0)
    problema =
      "Hay piezas que no entran en la plancha: el costo está incompleto.";

  return {
    formato,
    planchas: corte.planchas.reduce((s, p) => s + p.cobro.factor, 0),
    material,
    minutosLaser: laser.segundos / 60,
    servicio: redondear2(total - material),
    total: redondear2(total),
    problema,
  };
}
