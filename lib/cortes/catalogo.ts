/**
 * El catálogo de planchas en el idioma de la pantalla. Sin dependencias de
 * servidor: lo usan también los componentes del navegador.
 */

export interface FormatoPlancha {
  id: string;
  /** La referencia interna de Odoo. */
  codigo: string;
  anchoCm: number;
  largoCm: number;
  /** Un solo código en Odoo para todos los colores: el stock no es por color. */
  skuCompartido: boolean;
  /** El código o la medida están por confirmar contra Odoo. */
  porVerificar: boolean;
  nota: string | null;
  activo: boolean;
}

/** Un material en un color y un espesor: lo que pide el cliente. */
export interface GrupoPlancha {
  id: string;
  material: string;
  variante: string;
  detalle: string;
  espesorMm: number;
  /** Si las piezas se pueden girar al acomodarlas. */
  rotable: boolean;
  /** Si este grupo ya registra sus sobrantes en Odoo (el piloto). */
  sobrantesActivo: boolean;
  formatos: FormatoPlancha[];
}

/** "Cristal", "Blanco lechoso", "Espejo dorado", "White (KS-003)". */
export function colorDe(g: Pick<GrupoPlancha, "variante" | "detalle">): string {
  const variante = g.variante.trim();
  const detalle = g.detalle.trim();
  if (!variante) return detalle || "—";
  if (!detalle) return variante;
  // "Mate / Cristal" se lee mejor como "Mate cristal"; "Colores / Negro", igual.
  return `${variante} ${detalle.charAt(0).toLowerCase()}${detalle.slice(1)}`;
}

export const espesorTexto = (mm: number) => `${String(+mm.toFixed(2))} mm`;

/** "Acrílico ECO · Cristal · 3 mm". */
export const nombreDeGrupo = (g: Pick<GrupoPlancha, "material" | "variante" | "detalle" | "espesorMm">) =>
  `${g.material} · ${colorDe(g)} · ${espesorTexto(g.espesorMm)}`;

/** "122×183". */
export const medidaDe = (f: Pick<FormatoPlancha, "anchoCm" | "largoCm">) =>
  `${String(+f.anchoCm.toFixed(2))}×${String(+f.largoCm.toFixed(2))}`;

/** Si en el grupo algún formato comparte código entre colores. */
export const pideColor = (g: Pick<GrupoPlancha, "formatos">) => g.formatos.some((f) => f.skuCompartido);
