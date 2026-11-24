/**
 * Clientes y productos de Odoo, ya en el idioma de la app. Sin dependencias de
 * servidor: estos tipos los usan también los componentes del navegador.
 */

export interface ClienteOdoo {
  id: number;
  nombre: string;
  /** RUC o DNI, tal como está en `vat`. */
  documento: string | null;
  telefono: string | null;
  email: string | null;
  ciudad: string | null;
  esEmpresa: boolean;
  /** Si es un contacto de una empresa, el nombre de esa empresa. */
  empresa: string | null;
  /** Y su id: con él, elegir a esta persona es elegir a su empresa con ella de contacto. */
  empresaId?: number | null;
}

/**
 * Una persona de una empresa: un `res.partner` hijo (`parent_id`) de tipo contacto.
 * El teléfono y el correo de quien atiende pertenecen a ella, no a la empresa.
 */
export interface ContactoOdoo {
  id: number;
  /** La empresa de la que es contacto. */
  empresaId: number;
  nombre: string;
  /** El puesto (`function`), si Odoo lo tiene. */
  cargo: string | null;
  telefono: string | null;
  email: string | null;
}

export interface ProductoOdoo {
  id: number;
  nombre: string;
  /** La referencia interna (`default_code`). */
  codigo: string | null;
  barcode: string | null;
  /** Precio de venta de Odoo. Es el punto de partida; en la línea se puede cambiar. */
  precio: number;
  unidad: string | null;
  categoria: string | null;
}

/** Un resultado del buscador, con lo que la pantalla necesita para pintarlo. */
export interface Resultado<T> {
  item: T;
  /** Si entró por el código, y cómo: la pantalla lo destaca. */
  porCodigo: "exacto" | "prefijo" | "contiene" | null;
  /** Cuántas veces se cotizó (clientes y productos sugeridos). */
  veces?: number;
}

export interface RespuestaBusqueda<T> {
  resultados: Resultado<T>[];
  /**
   * De dónde salió: sugerencias por uso (`recientes`), el índice del servidor
   * (`indice`) o una consulta directa a Odoo porque el índice no tenía nada (`odoo`).
   */
  origen: "recientes" | "indice" | "odoo";
}
