// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { ErrorContorno, extraerContornoVectorial, previsualizarContorno } from "./pdf-vector";

/** Una página de 400 × 300 pt: un logo con un agujero, una curva, una cota y objetos que no son del logo. */
async function pdfDePrueba(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([400, 300]);
  const negro = rgb(0, 0, 0);
  // Logo: rectángulo de 100 × 60 con un agujero de 60 × 20, arriba a la izquierda en la página (x 50, y 50).
  p.drawSvgPath("M 0 0 L 100 0 L 100 60 L 0 60 Z M 20 20 L 80 20 L 80 40 L 20 40 Z", { x: 50, y: 250, color: negro });
  // Una curva (arco) dentro de la región, a la derecha del rectángulo.
  p.drawSvgPath("M 0 0 C 0 -30 40 -30 40 0 Z", { x: 120, y: 220, color: negro });
  // Una cota (línea) dentro de la región: un trazo, no un relleno.
  p.drawLine({ start: { x: 60, y: 200 }, end: { x: 180, y: 200 }, thickness: 1, color: negro });
  // Un relleno que no es del logo: fuera de la región.
  p.drawRectangle({ x: 300, y: 20, width: 40, height: 30, color: rgb(1, 0, 0) });
  // Un fondo que cubre toda la página: tampoco entra (su caja excede la región).
  return d.save();
}

const REGION = { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 }; // 40–200 pt en X, 30–150 pt en Y (desde arriba)

describe("extraerContornoVectorial", () => {
  it("devuelve los rellenos de la región, a escala en mm, con la Y hacia arriba", async () => {
    const c = await extraerContornoVectorial(await pdfDePrueba(), { pagina: 1, region: REGION, anchoMm: 500 });
    // Rectángulo (con su agujero) + curva = 3 subtrazados; la cota y el rectángulo rojo no cuentan.
    expect(c.trazos).toHaveLength(3);
    // El logo mide de x = 50 (rectángulo) a x = 160 (curva): 110 pt → 500 mm.
    expect(c.anchoMm).toBe(500);
    expect(c.altoMm).toBeGreaterThan(0);
    // El rectángulo exterior arranca en su esquina superior izquierda: x = 0 mm.
    expect(c.trazos[0].startsWith("M 0 ")).toBe(true);
    expect(c.trazos[0].endsWith("Z")).toBe(true);
  });

  it("conserva las curvas como Bézier cúbicas, sin aproximarlas a rectas", async () => {
    const c = await extraerContornoVectorial(await pdfDePrueba(), { pagina: 1, region: REGION, anchoMm: 500 });
    expect(c.trazos.some((t) => / C /.test(t))).toBe(true);
  });

  it("escala en proporción: medio ancho, medio alto", async () => {
    const pdf = await pdfDePrueba();
    const grande = await extraerContornoVectorial(pdf, { pagina: 1, region: REGION, anchoMm: 400 });
    const chico = await extraerContornoVectorial(pdf, { pagina: 1, region: REGION, anchoMm: 200 });
    expect(chico.altoMm).toBeCloseTo(grande.altoMm / 2, 2);
  });

  it("con incluirTrazos también cuenta las líneas", async () => {
    const pdf = await pdfDePrueba();
    const sin = await extraerContornoVectorial(pdf, { pagina: 1, region: REGION, anchoMm: 500 });
    const con = await extraerContornoVectorial(pdf, { pagina: 1, region: REGION, anchoMm: 500, incluirTrazos: true });
    expect(con.trazos.length).toBeGreaterThan(sin.trazos.length);
  });

  it("explica el problema si la región no tiene relleno vectorial", async () => {
    const vacia = { x0: 0.6, y0: 0.6, x1: 0.9, y1: 0.9 };
    await expect(extraerContornoVectorial(await pdfDePrueba(), { pagina: 1, region: vacia, anchoMm: 100 })).rejects.toThrow(ErrorContorno);
  });

  it("rechaza una página que no existe", async () => {
    await expect(extraerContornoVectorial(await pdfDePrueba(), { pagina: 2, region: REGION, anchoMm: 100 })).rejects.toThrow(/no existe/);
  });
});

describe("previsualizarContorno", () => {
  it("devuelve un PNG", async () => {
    const c = await extraerContornoVectorial(await pdfDePrueba(), { pagina: 1, region: REGION, anchoMm: 500 });
    const png = Buffer.from(await previsualizarContorno(c), "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
