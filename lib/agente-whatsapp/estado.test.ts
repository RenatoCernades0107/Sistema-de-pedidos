import { describe, expect, it } from "vitest";
import { agenteResponde, leerEstado, siguienteEstado } from "./estado";

describe("siguienteEstado", () => {
  it("el agente deriva → necesita atención; un asesor responde → con asesor", () => {
    expect(siguienteEstado("agente", "agente_deriva")).toBe("necesita_atencion");
    expect(siguienteEstado("necesita_atencion", "asesor_responde")).toBe("asesor");
    expect(siguienteEstado("agente", "asesor_responde")).toBe("asesor");
  });

  it("mientras la atiende un humano, los mensajes del cliente no la cambian", () => {
    expect(siguienteEstado("necesita_atencion", "mensaje_cliente")).toBe("necesita_atencion");
    expect(siguienteEstado("asesor", "mensaje_cliente")).toBe("asesor");
    expect(siguienteEstado("agente", "mensaje_cliente")).toBe("agente");
  });

  it("una resuelta se reabre con el agente si el cliente vuelve a escribir", () => {
    expect(siguienteEstado("resuelta", "mensaje_cliente")).toBe("agente");
  });

  it("devolver y resolver valen desde cualquier estado", () => {
    for (const e of ["agente", "necesita_atencion", "asesor", "resuelta"] as const) {
      expect(siguienteEstado(e, "devolver_al_agente")).toBe("agente");
      expect(siguienteEstado(e, "resolver")).toBe("resuelta");
    }
  });

  it("el agente solo responde cuando la conversación es suya", () => {
    expect([agenteResponde("agente"), agenteResponde("necesita_atencion"), agenteResponde("asesor")]).toEqual([
      true,
      false,
      false,
    ]);
    expect(leerEstado("raro")).toBe("agente");
  });
});
