import { describe, expect, it } from "vitest";
import { cambioTexto, diferenciasDeConteo, esquemaBaja, esquemaCierre } from "./casos";

describe("lo que sale de un conteo", () => {
  const lineas = [
    { productoId: 1, codigo: "A", nombre: "A", contado: 5 },
    { productoId: 2, codigo: "B", nombre: "B", contado: 3 },
    { productoId: 3, codigo: "C", nombre: "C", contado: 4 },
    { productoId: 4, codigo: "D", nombre: "D", contado: null },
  ];
  const esperado = new Map([
    [1, 5],
    [2, 5],
    [3, 0],
    [4, 9],
  ]);

  it("lo que coincide no es caso; lo que falta o sobra, sí; lo que no se contó no cuenta", () => {
    const r = diferenciasDeConteo(lineas, [], esperado);
    expect(r.coinciden).toBe(1);
    expect(r.sinContar).toBe(1);
    expect(r.diferencias.map((d) => [d.codigo, d.esperado, d.contado, d.cantidad])).toEqual([
      ["B", 5, 3, -2],
      ["C", 0, 4, 4],
    ]);
  });

  it("un sobrante que no está es −1; uno sin marcar no cuenta", () => {
    const r = diferenciasDeConteo(
      [],
      [
        { codigo: "SOB-1", productoId: 9, encontrado: true },
        { codigo: "SOB-2", productoId: 9, encontrado: false },
        { codigo: "SOB-3", productoId: 9, encontrado: null },
      ],
      new Map(),
    );
    expect(r).toMatchObject({ coinciden: 1, sinContar: 1 });
    expect(r.diferencias).toEqual([expect.objectContaining({ sobrante: "SOB-2", cantidad: -1, productoId: 9 })]);
  });
});

describe("los esquemas", () => {
  const almacenId = "0b6c5c1e-1d2a-4f3b-9a4e-3c2d1e0f9a8b";
  it("una baja es de un producto o de un sobrante entero; 'otro' pide contar qué pasó", () => {
    expect(esquemaBaja.safeParse({ almacenId, productoId: 20, sobrante: null, cantidad: 2, motivo: "rotura", descripcion: null }).success).toBe(true);
    expect(esquemaBaja.safeParse({ almacenId, productoId: null, sobrante: "SOB-1", cantidad: 2, motivo: "perdido", descripcion: null }).success).toBe(false);
    expect(esquemaBaja.safeParse({ almacenId, productoId: 20, sobrante: "SOB-1", cantidad: 1, motivo: "rotura", descripcion: null }).success).toBe(false);
    expect(esquemaBaja.safeParse({ almacenId, productoId: 20, sobrante: null, cantidad: 1, motivo: "otro", descripcion: "" }).success).toBe(false);
  });

  it("cerrar un caso pide una razón", () => {
    expect(esquemaCierre.safeParse({ id: almacenId, decision: "aplicar", razon: "  ok " }).success).toBe(false);
    expect(esquemaCierre.safeParse({ id: almacenId, decision: "descartar", razon: "Apareció en el rack 3" }).success).toBe(true);
  });

  it("el cambio se escribe con su signo", () => {
    expect(cambioTexto(-2)).toBe("−2");
    expect(cambioTexto(0.5)).toBe("+0.5");
  });
});
