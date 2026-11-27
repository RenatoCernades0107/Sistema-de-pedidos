import { describe, expect, it } from "vitest";
import { mensajeDeFila, resumenDeFila, vistaPreviaMensaje } from "./pruebas";
import { ordenarConversaciones } from "./pruebas-servidor";

const fila = (o: Partial<Parameters<typeof mensajeDeFila>[0]>) =>
  mensajeDeFila({
    id: "m",
    rol: "cliente",
    contenido: "",
    adjuntos: null,
    traza: null,
    derivado: false,
    autor_id: null,
    creado_en: "2026-11-27T10:00:00Z",
    ...o,
  });

describe("mensajeDeFila", () => {
  it("los adjuntos del cliente y los del agente van cada uno a su lugar", () => {
    const delCliente = fila({
      rol: "cliente",
      adjuntos: [{ ruta: "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg", nombre: "foto.jpg", mime: "image/jpeg", tamano: 5 }],
    });
    expect(delCliente.adjuntosCliente).toHaveLength(1);
    expect(delCliente.adjuntos).toEqual([]);

    const delAgente = fila({
      rol: "agente",
      adjuntos: [{ documentoId: "d", nombre: "Catálogo.pdf", mime: "application/pdf", tipo: "catalogo" }],
    });
    expect(delAgente.adjuntos).toHaveLength(1);
    expect(delAgente.adjuntosCliente).toEqual([]);
  });

  it("lee el rol asesor y su autor", () => {
    expect(fila({ rol: "asesor", autor_id: "u1" })).toMatchObject({ rol: "asesor", autorId: "u1" });
  });
});

describe("vistaPreviaMensaje", () => {
  it("dice quién escribió, o que el agente la pasó a un asesor", () => {
    expect(vistaPreviaMensaje({ rol: "cliente", contenido: "hola\nqué tal" })).toBe("Cliente: hola qué tal");
    expect(vistaPreviaMensaje({ rol: "agente", contenido: "" })).toBe("El agente la pasó a un asesor");
    expect(vistaPreviaMensaje({ rol: "cliente", contenido: "" })).toBe("Cliente: (adjunto)");
    expect(vistaPreviaMensaje(null)).toBe("Sin mensajes");
  });
});

describe("ordenarConversaciones", () => {
  const c = (id: string, estado: string, actualizado: string, atencion: string | null = null) =>
    resumenDeFila({
      id,
      titulo: id,
      anuncio: null,
      actualizado_en: actualizado,
      estado,
      motivo_atencion: null,
      atencion_desde: atencion,
    });

  it("primero las que esperan a un humano (la más antigua arriba), después por actividad", () => {
    const orden = ordenarConversaciones([
      c("reciente", "agente", "2026-11-27T12:00:00Z"),
      c("espera-poco", "necesita_atencion", "2026-11-27T11:00:00Z", "2026-11-27T11:00:00Z"),
      c("espera-mucho", "necesita_atencion", "2026-11-27T11:30:00Z", "2026-11-27T09:00:00Z"),
      c("vieja", "resuelta", "2026-11-26T12:00:00Z"),
    ]).map((x) => x.id);
    expect(orden).toEqual(["espera-mucho", "espera-poco", "reciente", "vieja"]);
  });
});
