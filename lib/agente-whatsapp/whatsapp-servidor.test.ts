import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoWhatsapp } from "./webhook";
import type { RespuestaAgente } from "./tipos";

/* ── Lo de afuera, de mentira ── */

type Rpc = (nombre: string, args: Record<string, unknown>) => { data: unknown; error: null };
let rpc: Rpc;
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase-servidor", () => ({
  clienteServidor: async () => ({
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, args });
      return rpc(nombre, args);
    },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  }),
}));

const enviados: unknown[] = [];
let fallaEnvio = false;
vi.mock("./canal", () => ({
  clienteWhatsApp: () => ({ messages: { markRead: async () => ({}) } }),
  enviarRespuesta: async (_c: unknown, destino: unknown, mensajes: unknown) => {
    if (fallaEnvio) throw new Error("(#131047) Re-engagement message");
    enviados.push({ destino, mensajes });
  },
  anuncioDeReferral: () => null,
}));

let respuesta: RespuestaAgente;
const motor = vi.fn(async () => respuesta);
vi.mock("./motor", () => ({ responderMensaje: motor }));
vi.mock("./config", () => ({ agenteConfigurado: () => true, perfilDelAgente: () => ({ clave: "k", modelo: "m", respaldo: [] }) }));

const { procesarEventos } = await import("./whatsapp-servidor");

const evento = (o: Partial<EventoWhatsapp> = {}): EventoWhatsapp => ({
  rol: "cliente",
  phoneNumberId: "PNID",
  telefono: "519",
  contacto: "Juan",
  wamid: "wamid.1",
  texto: "precio acrilico 3mm",
  adjuntos: [],
  anuncio: null,
  creadoEn: "2026-11-27T10:00:00Z",
  ...o,
});

/** La base: la conversación está en `estado`; el wamid `repetido` ya estaba. */
function base({ estado = "agente", repetido = "", puede = true } = {}) {
  rpc = (nombre, args) => {
    switch (nombre) {
      case "wa_recibir_mensaje":
        return {
          data: [{ conversacion_id: "conv-1", estado, duplicado: args.p_wamid === repetido, anuncio: null }],
          error: null,
        };
      case "wa_historial":
        return { data: [{ rol: "cliente", contenido: "precio acrilico 3mm", adjuntos: null, creado_en: "x" }], error: null };
      case "wa_contexto":
        return { data: { empresa: {}, ajustes: {}, lista_precios: {}, cuentas: [], archivos: [] }, error: null };
      case "wa_guardar_respuesta":
        return { data: puede, error: null };
      default:
        return { data: null, error: null };
    }
  };
}

beforeEach(() => {
  llamadas.length = 0;
  enviados.length = 0;
  fallaEnvio = false;
  motor.mockClear();
  respuesta = { mensajes: [{ tipo: "texto", texto: "Está a S/ 180." }], traza: [], derivado: false };
});

const nombres = () => llamadas.map((l) => l.nombre);

describe("procesarEventos", () => {
  it("guarda el mensaje, hace responder al agente y manda la respuesta por WhatsApp", async () => {
    base();
    await procesarEventos([evento()]);
    expect(nombres()).toEqual(["wa_recibir_mensaje", "wa_historial", "wa_contexto", "wa_guardar_respuesta"]);
    expect(enviados).toEqual([
      { destino: { phoneNumberId: "PNID", to: "519" }, mensajes: [{ tipo: "texto", texto: "Está a S/ 180." }] },
    ]);
  });

  it("si el agente deriva, guarda la nota y no le manda nada al cliente", async () => {
    base();
    respuesta = { mensajes: [], traza: [], derivado: true, motivoDerivacion: "cotizar corte" };
    await procesarEventos([evento()]);
    const guardar = llamadas.find((l) => l.nombre === "wa_guardar_respuesta");
    expect(guardar?.args).toMatchObject({ p_derivado: true, p_motivo: "cotizar corte" });
    expect(enviados).toEqual([]);
  });

  it("si la conversación la atiende un humano, ni siquiera llama al agente", async () => {
    base({ estado: "necesita_atencion" });
    await procesarEventos([evento()]);
    expect(motor).not.toHaveBeenCalled();
    expect(nombres()).toEqual(["wa_recibir_mensaje"]);
  });

  it("un reintento de Kapso (wamid repetido) no se responde dos veces", async () => {
    base({ repetido: "wamid.1" });
    await procesarEventos([evento()]);
    expect(motor).not.toHaveBeenCalled();
  });

  it("si un asesor la tomó mientras el agente pensaba, no se manda", async () => {
    base({ puede: false });
    await procesarEventos([evento()]);
    expect(motor).toHaveBeenCalled();
    expect(enviados).toEqual([]);
  });

  it("si respondió el equipo desde el celular después del cliente, el agente no contesta", async () => {
    base();
    rpc = ((original) => (nombre: string, args: Record<string, unknown>) =>
      nombre === "wa_recibir_mensaje" && args.p_rol === "asesor"
        ? { data: [{ conversacion_id: "conv-1", estado: "asesor", duplicado: false, anuncio: null }], error: null }
        : original(nombre, args))(rpc);
    await procesarEventos([evento(), evento({ rol: "asesor", wamid: "wamid.2", creadoEn: "2026-11-27T10:01:00Z" })]);
    expect(motor).not.toHaveBeenCalled();
  });

  it("si WhatsApp no acepta el envío, la pasa a una persona", async () => {
    base();
    fallaEnvio = true;
    await procesarEventos([evento()]);
    const pedido = llamadas.find((l) => l.nombre === "wa_pedir_atencion");
    expect(String(pedido?.args.p_motivo)).toContain("no se pudo enviar por WhatsApp");
  });

  it("si el modelo falla, la pasa a una persona", async () => {
    base();
    motor.mockRejectedValueOnce(new Error("saturado"));
    await procesarEventos([evento()]);
    expect(nombres()).toContain("wa_pedir_atencion");
    expect(enviados).toEqual([]);
  });
});
