import { describe, expect, it } from "vitest";
import { avisoDe, leerSeguimiento, pasosDe } from "./seguimiento";

const h = (estado: string, fecha: string) => ({ estado, fecha });

describe("pasosDe", () => {
  it("recoger en tienda no pasa por 'en camino'", () => {
    const pasos = pasosDe({ estado: "en_proceso", lugarEntrega: "tienda", historial: [] });
    expect(pasos.map((p) => p.estado)).toEqual(["registrado", "en_proceso", "listo", "entregado"]);
    expect(pasos.map((p) => p.situacion)).toEqual(["hecho", "actual", "pendiente", "pendiente"]);
  });

  it("a domicilio sí, con las fechas del historial", () => {
    const pasos = pasosDe({
      estado: "en_transito",
      lugarEntrega: "domicilio",
      historial: [
        h("registrado", "2026-11-10T14:00:00Z"),
        h("en_proceso", "2026-11-11T14:00:00Z"),
        h("listo", "2026-11-12T14:00:00Z"),
        h("en_transito", "2026-11-13T14:00:00Z"),
      ] as never,
    });
    expect(pasos.map((p) => p.estado)).toContain("en_transito");
    expect(pasos.find((p) => p.estado === "en_transito")).toMatchObject({
      situacion: "actual",
      fecha: "2026-11-13T14:00:00Z",
    });
    expect(pasos.at(-1)).toMatchObject({ estado: "entregado", situacion: "pendiente", fecha: null });
  });

  it("observado deja el avance donde estaba", () => {
    const pasos = pasosDe({
      estado: "observado",
      lugarEntrega: "tienda",
      historial: [h("registrado", "2026-11-10T14:00:00Z"), h("en_proceso", "2026-11-11T14:00:00Z")] as never,
    });
    expect(pasos.find((p) => p.situacion === "actual")?.estado).toBe("en_proceso");
    expect(avisoDe("observado")?.titulo).toMatch(/observación/);
  });

  it("entregado: todo hecho", () => {
    const pasos = pasosDe({ estado: "entregado", lugarEntrega: "agencia", historial: [] });
    expect(pasos.every((p) => p.situacion === "hecho")).toBe(true);
  });
});

describe("leerSeguimiento", () => {
  it("traduce la RPC y descarta lo que no entiende", () => {
    expect(leerSeguimiento(null)).toBeNull();
    expect(leerSeguimiento({ estado: "listo" })).toBeNull();

    const s = leerSeguimiento({
      codigo: "LCL_0001_ABCD",
      cliente: "Juan Pérez",
      estado: "listo",
      fecha_creacion: "2026-11-10T14:00:00Z",
      fecha_prometida: "2026-11-15",
      fecha_entrega: null,
      lugar_entrega: "agencia",
      direccion_entrega: null,
      es_provincia: true,
      departamento: "Cusco",
      provincia: "Cusco",
      agencia: "Shalom",
      detalle: "",
      actualizado_en: "2026-11-12T14:00:00Z",
      historial: [{ estado: "registrado", fecha: "2026-11-10T14:00:00Z" }, { nada: 1 }],
      lineas: [{ posicion: 1, tipo: "producto", nombre: "Caja", codigo: null, descripcion: null, cantidad: "3" }],
    });
    expect(s).toMatchObject({
      codigo: "LCL_0001_ABCD",
      destino: "Cusco, Cusco",
      agencia: "Shalom",
      historial: [{ estado: "registrado" }],
      lineas: [{ nombre: "Caja", cantidad: 3, corte: null }],
    });
  });
});
