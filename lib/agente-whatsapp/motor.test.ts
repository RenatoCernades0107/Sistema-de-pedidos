import { describe, expect, it, vi } from "vitest";
import type { EventoLlm, PeticionChat } from "@/lib/llm/inferhub";
import { AJUSTES_POR_DEFECTO } from "./ajustes";
import type { ContextoHerramientas } from "./herramientas";
import { MAX_VUELTAS, mensajesDeHistorial, responderMensaje } from "./motor";

type Turno = { texto?: string; llamadas?: { nombre: string; argumentos: Record<string, unknown> }[] };

/** Un modelo de mentira que responde, en orden, lo que se le diga. Guarda lo que recibió. */
function modelo(turnos: Turno[]) {
  const recibido: PeticionChat[] = [];
  let i = 0;
  const transmitir = async function* (p: PeticionChat): AsyncGenerator<EventoLlm> {
    recibido.push(structuredClone({ ...p, senal: undefined }));
    const t = turnos[Math.min(i++, turnos.length - 1)];
    if (t.texto) yield { tipo: "texto", delta: t.texto };
    for (const [n, l] of (t.llamadas ?? []).entries()) {
      yield { tipo: "llamada_herramienta", id: `l${i}-${n}`, nombre: l.nombre, argumentos: l.argumentos };
    }
    yield { tipo: "fin", motivo: t.llamadas?.length ? "herramientas" : "fin" };
  };
  return { transmitir, recibido };
}

function contexto() {
  return {
    buscarPrecios: vi.fn<ContextoHerramientas["buscarPrecios"]>(async () => ({
      encontrados: [{ tipo: "plancha" as const, producto: "ACRILICO CRISTAL 3 mm", codigo: "A3", medida: "1.22 × 2.44 m", precio: 180 }],
      mas: 0,
    })),
    buscarInformacion: vi.fn<ContextoHerramientas["buscarInformacion"]>(async () => []),
    datosEmpresa: vi.fn<ContextoHerramientas["datosEmpresa"]>(async () => ({
      direccion: "Av. Siempre Viva 123",
      referencia: "",
      distrito: "Lima",
      mapsUrl: "",
      horario: "L-V 9 a 6",
      telefono: "",
      cuentas: [],
    })),
    archivosEnviables: vi.fn<ContextoHerramientas["archivosEnviables"]>(async () => [
      { documentoId: "doc-1", nombre: "Catálogo 2026.pdf", mime: "application/pdf" as const, tipo: "catalogo" as const, descripcion: "" },
    ]),
  };
}

const base = {
  ajustes: AJUSTES_POR_DEFECTO,
  perfil: { clave: "k", modelo: "m", respaldo: [] },
};

describe("responderMensaje", () => {
  it("usa una herramienta y contesta con lo que trajo", async () => {
    const ctx = contexto();
    const { transmitir, recibido } = modelo([
      { llamadas: [{ nombre: "buscar_precios", argumentos: { consulta: "acrilico cristal 3mm" } }] },
      { texto: "El acrílico cristal de 3 mm (1.22 × 2.44 m) está a *S/ 180*." },
    ]);
    const r = await responderMensaje({
      ...base,
      historial: [{ rol: "cliente", contenido: "precio acrilico cristal 3mm" }],
      contexto: ctx,
      transmitir,
    });
    expect(r.mensajes).toEqual([{ tipo: "texto", texto: "El acrílico cristal de 3 mm (1.22 × 2.44 m) está a *S/ 180*." }]);
    expect(r.derivado).toBe(false);
    expect(r.traza).toHaveLength(1);
    expect(r.traza[0]).toMatchObject({ herramienta: "buscar_precios", resumen: "1 precio" });
    expect(ctx.buscarPrecios).toHaveBeenCalledWith("acrilico cristal 3mm");
    // La segunda vuelta lleva el resultado de la herramienta.
    const ultimo = recibido[1].mensajes.at(-1);
    expect(ultimo).toMatchObject({ rol: "herramienta" });
    expect(JSON.stringify(ultimo)).toContain("180");
    // El perfil del agente llega al modelo.
    expect(recibido[0].perfil).toEqual(base.perfil);
  });

  it("los archivos van después del texto, sin repetirse", async () => {
    const { transmitir } = modelo([
      {
        llamadas: [
          { nombre: "enviar_archivo", argumentos: { documento_id: "doc-1", texto: "Aquí tienes" } },
          { nombre: "enviar_archivo", argumentos: { documento_id: "doc-1" } },
        ],
      },
      { texto: "Te envío nuestro catálogo 👇" },
    ]);
    const r = await responderMensaje({ ...base, historial: [{ rol: "cliente", contenido: "catálogo?" }], contexto: contexto(), transmitir });
    expect(r.mensajes.map((m) => m.tipo)).toEqual(["texto", "archivo"]);
    expect(r.mensajes[1]).toMatchObject({ adjunto: { documentoId: "doc-1" }, texto: "Aquí tienes" });
  });

  it("un archivo que no se puede enviar vuelve como error al modelo", async () => {
    const { transmitir, recibido } = modelo([
      { llamadas: [{ nombre: "enviar_archivo", argumentos: { documento_id: "no-existe" } }] },
      { texto: "No lo tengo a la mano." },
    ]);
    const r = await responderMensaje({ ...base, historial: [{ rol: "cliente", contenido: "foto" }], contexto: contexto(), transmitir });
    expect(r.mensajes).toHaveLength(1);
    expect(r.traza[0].error).toBe(true);
    expect(JSON.stringify(recibido[1].mensajes.at(-1))).toContain("listar_archivos");
  });

  it("deriva a un asesor cuando le piden cotizar un corte", async () => {
    const { transmitir } = modelo([
      { llamadas: [{ nombre: "derivar_a_asesor", argumentos: { motivo: "cotizar corte" } }] },
      { texto: "Te paso con un asesor 🙌" },
    ]);
    const r = await responderMensaje({
      ...base,
      historial: [{ rol: "cliente", contenido: "quiero 10 piezas de 20x30 cortadas" }],
      contexto: contexto(),
      transmitir,
    });
    expect(r.derivado).toBe(true);
    expect(r.motivoDerivacion).toBe("cotizar corte");
  });

  it("si una fuente falla, el modelo se entera y la traza lo marca", async () => {
    const ctx = contexto();
    ctx.datosEmpresa.mockRejectedValue(new Error("sin conexión"));
    const { transmitir, recibido } = modelo([
      { llamadas: [{ nombre: "datos_empresa", argumentos: {} }] },
      { texto: "Un asesor te confirma la dirección." },
    ]);
    const r = await responderMensaje({ ...base, historial: [{ rol: "cliente", contenido: "dirección?" }], contexto: ctx, transmitir });
    expect(r.traza[0]).toMatchObject({ herramienta: "datos_empresa", error: true });
    expect(JSON.stringify(recibido[1].mensajes.at(-1))).toContain("No inventes");
  });

  it("si no termina en MAX_VUELTAS, deriva con el mensaje de Ajustes", async () => {
    const { transmitir } = modelo([{ llamadas: [{ nombre: "buscar_informacion", argumentos: { consulta: "x" } }] }]);
    const r = await responderMensaje({ ...base, historial: [{ rol: "cliente", contenido: "?" }], contexto: contexto(), transmitir });
    expect(r.derivado).toBe(true);
    expect(r.mensajes[0]).toEqual({ tipo: "texto", texto: AJUSTES_POR_DEFECTO.mensajeDerivacion });
    expect(r.traza.filter((p) => p.herramienta === "buscar_informacion")).toHaveLength(MAX_VUELTAS);
  });

  it("con anuncio, las instrucciones lo mencionan", async () => {
    const { transmitir, recibido } = modelo([{ texto: "¡Hola! Sobre el acrílico cristal…" }]);
    await responderMensaje({
      ...base,
      historial: [{ rol: "cliente", contenido: "Hola, quiero más información" }],
      anuncio: { sourceId: "9", titulo: "Acrílico cristal en oferta" },
      contexto: contexto(),
      transmitir,
    });
    expect(recibido[0].sistema).toContain("Acrílico cristal en oferta");
  });
});

describe("mensajesDeHistorial", () => {
  it("convierte turnos y dice qué archivos se enviaron", () => {
    expect(
      mensajesDeHistorial([
        { rol: "cliente", contenido: "hola" },
        {
          rol: "agente",
          contenido: "Te envío el catálogo",
          adjuntos: [{ documentoId: "d", nombre: "Catálogo.pdf", mime: "application/pdf", tipo: "catalogo" }],
        },
        { rol: "cliente", contenido: "  " },
      ]),
    ).toEqual([
      { rol: "usuario", contenido: "hola" },
      { rol: "asistente", contenido: "Te envío el catálogo\n[Enviaste: Catálogo.pdf]" },
    ]);
  });
});
