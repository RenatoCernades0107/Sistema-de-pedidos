import { describe, expect, it } from "vitest";
import { deAdjuntos, esquemaAdjuntos, rutaDeDiseno, rutaNueva, rutasAReenviar, type AdjuntoCad } from "./adjuntos";

const DISENO = "6f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b";

const adjunto = (ruta: string, mime: AdjuntoCad["mime"] = "image/png"): AdjuntoCad => ({
  ruta,
  nombre: "x.png",
  mime,
  tamano: 100,
});

describe("adjuntos del chat de diseños", () => {
  it("la ruta nueva va en la carpeta del diseño, con la extensión de su tipo", () => {
    const ruta = rutaNueva(DISENO, "application/pdf");
    expect(rutaDeDiseno(ruta, DISENO)).toBe(true);
    expect(ruta).toMatch(/\.pdf$/);
    expect(esquemaAdjuntos.safeParse([adjunto(ruta, "application/pdf")]).success).toBe(true);
    expect(rutaNueva(DISENO, "image/jpeg")).toMatch(/\.jpg$/);
  });

  it("rechaza rutas raras, tipos que el modelo no lee y archivos de más", () => {
    expect(esquemaAdjuntos.safeParse([adjunto(`${DISENO}/../otro.png`)]).success).toBe(false);
    expect(esquemaAdjuntos.safeParse([adjunto(`otra/${DISENO}.png`)]).success).toBe(false);
    expect(
      esquemaAdjuntos.safeParse([{ ...adjunto(rutaNueva(DISENO, "image/png")), mime: "image/gif" }]).success,
    ).toBe(false);
    const muchos = Array.from({ length: 7 }, () => adjunto(rutaNueva(DISENO, "image/png")));
    expect(esquemaAdjuntos.safeParse(muchos).success).toBe(false);
  });

  it("una ruta de otro diseño no es de este", () => {
    expect(rutaDeDiseno(rutaNueva("00000000-0000-4000-8000-000000000000", "image/png"), DISENO)).toBe(false);
  });

  it("lee lo guardado y salta lo que no entiende", () => {
    const bueno = adjunto(rutaNueva(DISENO, "image/webp"), "image/webp");
    expect(deAdjuntos([bueno, { ruta: 1 }, null])).toEqual([bueno]);
    expect(deAdjuntos(null)).toEqual([]);
  });

  it("reenvía enteros solo los más recientes", () => {
    const [a, b, c] = ["a", "b", "c"].map((r) => adjunto(r));
    expect(rutasAReenviar([[a], [], [b, c]], 2)).toEqual(new Set(["b", "c"]));
    expect(rutasAReenviar([[a]], 0)).toEqual(new Set());
  });
});
