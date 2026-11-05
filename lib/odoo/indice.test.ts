import { describe, expect, it, vi } from "vitest";
import { IndiceOdoo } from "./indice";
import type { Lote } from "./clientes";

interface Item {
  id: number;
  nombre: string;
}

/** Una fuente controlada: cada llamada devuelve el siguiente lote preparado y anota con qué `desde`. */
function fuente(lotes: (Lote<Item> | Error)[]) {
  const desdes: (string | null)[] = [];
  const cargar = vi.fn(async (desde: string | null) => {
    desdes.push(desde);
    const lote = lotes.shift();
    if (!lote) return { items: [], retirados: [], ultimaEscritura: desde };
    if (lote instanceof Error) throw lote;
    return lote;
  });
  return { cargar, desdes };
}

const reloj = () => {
  let t = 1_000_000;
  return { ahora: () => t, avanzar: (ms: number) => (t += ms) };
};

const campos = (i: Item) => ({ nombre: i.nombre });

describe("IndiceOdoo", () => {
  it("carga entero la primera vez y después solo lo cambiado desde el último write_date", async () => {
    const r = reloj();
    const f = fuente([
      { items: [{ id: 1, nombre: "ACRILICO 3MM" }, { id: 2, nombre: "PVC 10MM" }], retirados: [], ultimaEscritura: "2026-11-01 10:00:00" },
      { items: [{ id: 2, nombre: "PVC ESPUMADO 10MM" }, { id: 3, nombre: "MDF 5MM" }], retirados: [1], ultimaEscritura: "2026-11-01 10:05:00" },
    ]);
    const indice = new IndiceOdoo(f.cargar, campos, { refrescoMs: 60_000, recargaCompletaMs: 1_800_000, ahora: r.ahora });

    await indice.asegurar();
    expect(indice.tamano).toBe(2);

    // Antes del plazo no vuelve a preguntar.
    r.avanzar(30_000);
    await indice.asegurar();
    expect(f.cargar).toHaveBeenCalledTimes(1);

    r.avanzar(31_000);
    await indice.asegurar();
    expect(f.desdes).toEqual([null, "2026-11-01 10:00:00"]);
    // Actualiza el que cambió, agrega el nuevo y saca el archivado.
    expect(indice.obtener(2)?.nombre).toBe("PVC ESPUMADO 10MM");
    expect(indice.obtener(3)).toBeDefined();
    expect(indice.obtener(1)).toBeUndefined();
  });

  it("recarga entero pasado el plazo largo", async () => {
    const r = reloj();
    const f = fuente([
      { items: [{ id: 1, nombre: "A" }], retirados: [], ultimaEscritura: "t1" },
      { items: [{ id: 9, nombre: "Z" }], retirados: [], ultimaEscritura: "t9" },
    ]);
    const indice = new IndiceOdoo(f.cargar, campos, { refrescoMs: 60_000, recargaCompletaMs: 600_000, ahora: r.ahora });
    await indice.asegurar();
    r.avanzar(600_000);
    await indice.asegurar();
    expect(f.desdes).toEqual([null, null]);
    expect(indice.obtener(1)).toBeUndefined();
    expect(indice.obtener(9)).toBeDefined();
  });

  it("varias búsquedas a la vez comparten una sola carga", async () => {
    const f = fuente([{ items: [{ id: 1, nombre: "A" }], retirados: [], ultimaEscritura: "t" }]);
    const indice = new IndiceOdoo(f.cargar, campos);
    await Promise.all([indice.asegurar(), indice.asegurar(), indice.buscadorActual()]);
    expect(f.cargar).toHaveBeenCalledTimes(1);
  });

  it("sin índice, un fallo de carga sube; con índice viejo, se sigue buscando", async () => {
    const r = reloj();
    const f = fuente([
      new Error("Odoo caído"),
      { items: [{ id: 1, nombre: "ACRILICO" }], retirados: [], ultimaEscritura: "t" },
      new Error("Odoo caído otra vez"),
    ]);
    const indice = new IndiceOdoo(f.cargar, campos, { refrescoMs: 1000, ahora: r.ahora });

    await expect(indice.asegurar()).rejects.toThrow("Odoo caído");
    await indice.asegurar();
    r.avanzar(2000);
    await expect(indice.asegurar()).resolves.toBeUndefined();
    expect((await indice.buscadorActual()).buscar("acrilico")).toHaveLength(1);
  });

  it("lo que agrega la app se encuentra al instante, y el buscador se rehace solo si algo cambió", async () => {
    const f = fuente([{ items: [{ id: 1, nombre: "ACRILICO" }], retirados: [], ultimaEscritura: "t" }]);
    const indice = new IndiceOdoo(f.cargar, campos);
    const antes = await indice.buscadorActual();
    expect(await indice.buscadorActual()).toBe(antes);

    indice.agregar({ id: 2, nombre: "Corporación Nueva SAC" });
    const despues = await indice.buscadorActual();
    expect(despues).not.toBe(antes);
    expect(despues.buscar("nueva")[0].item.id).toBe(2);
  });
});
