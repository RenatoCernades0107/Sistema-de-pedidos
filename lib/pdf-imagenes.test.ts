// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { imagenesDePdf } from "./pdf-imagenes";

async function pdfDe(paginas: number) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    const p = d.addPage([400, 300]);
    p.drawText(`Letrero ${i + 1}`, { x: 50, y: 150, size: 24, font: f });
  }
  return d.save();
}

describe("imagenesDePdf", () => {
  it("devuelve un PNG por página, hasta el tope", async () => {
    const { paginas, total } = await imagenesDePdf(await pdfDe(3), { maxPaginas: 2 });
    expect(total).toBe(3);
    expect(paginas.map((p) => p.numero)).toEqual([1, 2]);
    const png = Buffer.from(paginas[0].png, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("lanza con un archivo que no es PDF", async () => {
    await expect(imagenesDePdf(new TextEncoder().encode("hola"), { maxPaginas: 1 })).rejects.toThrow();
  });
});
