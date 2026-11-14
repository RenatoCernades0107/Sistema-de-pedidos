import { describe, expect, it } from "vitest";
import type { EventoLlm } from "@/lib/llm/inferhub";
import { NOMBRE_POR_DEFECTO, generarTitulo, limpiarTitulo, tituloDeRespaldo } from "./titulo";

function modelo(...trozos: string[]) {
  return async function* (): AsyncGenerator<EventoLlm> {
    for (const delta of trozos) yield { tipo: "texto", delta };
    yield { tipo: "fin", motivo: "fin" };
  };
}

describe("limpiarTitulo", () => {
  it("quita comillas, punto final y prefijos", () => {
    expect(limpiarTitulo('"Caja acrílica con tapa."')).toBe("Caja acrílica con tapa");
    expect(limpiarTitulo("Título: «Porta afiche A4»")).toBe("Porta afiche A4");
    expect(limpiarTitulo("**Alzador**\nexplicación")).toBe("Alzador");
  });

  it("recorta lo demasiado largo", () => {
    const t = limpiarTitulo("palabra ".repeat(30));
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
  });

  it("devuelve vacío si no queda nada", () => {
    expect(limpiarTitulo('  "" \n ')).toBe("");
  });
});

describe("tituloDeRespaldo", () => {
  it("toma las primeras palabras con mayúscula inicial", () => {
    expect(tituloDeRespaldo("una caja de 20 × 15 × 10 cm en acrílico")).toBe("Una caja de 20 × 15…");
    expect(tituloDeRespaldo("hola")).toBe("Hola");
  });

  it("usa el nombre por defecto si el mensaje está vacío", () => {
    expect(tituloDeRespaldo("   ")).toBe(NOMBRE_POR_DEFECTO);
  });
});

describe("generarTitulo", () => {
  it("junta el texto del modelo y lo limpia", async () => {
    const t = await generarTitulo("quiero una caja", { transmitir: modelo('"Caja ', 'con tapa"') });
    expect(t).toBe("Caja con tapa");
  });

  it("cae al respaldo si el modelo falla", async () => {
    const t = await generarTitulo("porta afiche A4 vertical", {
      transmitir: async function* () {
        yield* [] as EventoLlm[];
        throw new Error("caído");
      },
    });
    expect(t).toBe("Porta afiche A4 vertical");
  });

  it("cae al respaldo si el modelo no dice nada", async () => {
    expect(await generarTitulo("un alzador", { transmitir: modelo("  ") })).toBe("Un alzador");
  });
});
