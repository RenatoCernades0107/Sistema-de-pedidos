/**
 * Un catálogo de Odoo guardado en la memoria del servidor, para buscar en él al
 * ritmo del teclado.
 *
 * Por qué no preguntarle a Odoo en cada tecla: su `ilike` no perdona tildes ni
 * errores de tipeo, no sabe de códigos compactados, y cada consulta cuesta un
 * viaje. Aquí se busca en memoria con `lib/busqueda-inteligente.ts`.
 *
 * Por qué no se queda viejo:
 *   - La primera vez se carga entero.
 *   - Después, como mucho cada `refrescoMs`, se piden solo los registros tocados
 *     desde el último `write_date` visto: una consulta mínima.
 *   - Cada `recargaCompletaMs` se vuelve a cargar entero, por si algo se escapó.
 *   - Lo que la app crea (un cliente nuevo) entra al instante con `agregar()`.
 *   - Si aun así no encuentra nada, quien busca cae a una consulta directa a Odoo.
 *
 * Vive por instancia del servidor: en Vercel, cada instancia fría carga el suyo.
 */

import { Buscador, type CamposBuscables } from "../busqueda-inteligente";
import type { Lote } from "./clientes";

export interface OpcionesIndice {
  refrescoMs: number;
  recargaCompletaMs: number;
  /** Inyectable para las pruebas. */
  ahora: () => number;
}

const POR_DEFECTO: OpcionesIndice = {
  refrescoMs: 60_000,
  recargaCompletaMs: 30 * 60_000,
  ahora: () => Date.now(),
};

export class IndiceOdoo<T extends { id: number }> {
  private items = new Map<number, T>();
  private cursor: string | null = null;
  private cargadoEn = 0;
  private revisadoEn = 0;
  private enCurso: Promise<void> | null = null;
  private version = 0;
  private buscador: { version: number; instancia: Buscador<T> } | null = null;
  private readonly opciones: OpcionesIndice;

  constructor(
    private readonly cargar: (desde: string | null) => Promise<Lote<T>>,
    private readonly campos: (item: T) => CamposBuscables,
    opciones: Partial<OpcionesIndice> = {},
  ) {
    this.opciones = { ...POR_DEFECTO, ...opciones };
  }

  /** Deja el índice al día según los plazos. Varias llamadas a la vez comparten la carga. */
  async asegurar(): Promise<void> {
    if (this.enCurso) return this.enCurso;

    const ahora = this.opciones.ahora();
    const completa =
      this.cargadoEn === 0 || ahora - this.cargadoEn >= this.opciones.recargaCompletaMs;
    const delta = !completa && ahora - this.revisadoEn >= this.opciones.refrescoMs;
    if (!completa && !delta) return;

    this.enCurso = (completa ? this.cargaCompleta() : this.actualizacion()).finally(() => {
      this.enCurso = null;
    });
    return this.enCurso;
  }

  private async cargaCompleta() {
    try {
      const lote = await this.cargar(null);
      this.items = new Map(lote.items.map((i) => [i.id, i]));
      this.cursor = lote.ultimaEscritura;
      this.cargadoEn = this.revisadoEn = this.opciones.ahora();
      this.version++;
    } catch (e) {
      // Con un índice viejo se sigue buscando; sin ninguno, el error sube.
      if (this.cargadoEn === 0) throw e;
      this.revisadoEn = this.opciones.ahora();
    }
  }

  private async actualizacion() {
    try {
      const lote = await this.cargar(this.cursor);
      for (const item of lote.items) this.items.set(item.id, item);
      for (const id of lote.retirados) this.items.delete(id);
      if (lote.ultimaEscritura) this.cursor = lote.ultimaEscritura;
      if (lote.items.length || lote.retirados.length) this.version++;
    } catch {
      // Una actualización fallida no tumba la búsqueda: se reintenta en el próximo plazo.
    } finally {
      this.revisadoEn = this.opciones.ahora();
    }
  }

  /** Empieza a cargar sin esperar. Para precalentar al abrir el formulario. */
  calentar() {
    this.asegurar().catch(() => {});
  }

  /** Lo que creó la app: disponible al instante, sin esperar al próximo refresco. */
  agregar(item: T) {
    this.items.set(item.id, item);
    this.version++;
  }

  obtener(id: number): T | undefined {
    return this.items.get(id);
  }

  get tamano() {
    return this.items.size;
  }

  /** El buscador sobre el contenido actual. Se rehace solo cuando el contenido cambió. */
  async buscadorActual(): Promise<Buscador<T>> {
    await this.asegurar();
    if (this.buscador?.version !== this.version) {
      this.buscador = {
        version: this.version,
        instancia: new Buscador([...this.items.values()], this.campos),
      };
    }
    return this.buscador.instancia;
  }
}
