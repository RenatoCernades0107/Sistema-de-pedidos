import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const procesar = vi.fn(async () => {});
vi.mock("@/lib/agente-whatsapp/whatsapp-servidor", () => ({ procesarEventos: procesar }));
vi.mock("next/server", () => ({ after: (f: () => unknown) => f() }));

const { POST } = await import("@/app/api/whatsapp/webhook/route");

const SECRETO = "secreto-de-prueba";
const cuerpo = JSON.stringify({
  message: { id: "wamid.1", from: "519", type: "text", text: { body: "hola" }, kapso: { direction: "inbound" } },
  conversation: { phone_number: "519" },
  phone_number_id: "PNID",
});
const firmar = (texto: string, secreto = SECRETO) => createHmac("sha256", secreto).update(texto).digest("hex");
const pedir = (firma?: string) =>
  POST(
    new Request("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      body: cuerpo,
      headers: { "x-webhook-event": "whatsapp.message.received", ...(firma ? { "x-webhook-signature": firma } : {}) },
    }),
  );

beforeEach(() => vi.stubEnv("KAPSO_WEBHOOK_SECRET", SECRETO));
afterEach(() => {
  vi.unstubAllEnvs();
  procesar.mockClear();
});

describe("POST /api/whatsapp/webhook", () => {
  it("con la firma de Kapso, acepta y procesa el mensaje", async () => {
    const r = await pedir(firmar(cuerpo));
    expect(r.status).toBe(200);
    expect(procesar).toHaveBeenCalledWith([expect.objectContaining({ wamid: "wamid.1", texto: "hola" })]);
  });

  it("sin firma, o con otra, rechaza sin tocar nada", async () => {
    expect((await pedir()).status).toBe(401);
    expect((await pedir(firmar(cuerpo, "otro-secreto"))).status).toBe(401);
    expect(procesar).not.toHaveBeenCalled();
  });

  it("sin el secreto configurado no acepta nada", async () => {
    vi.stubEnv("KAPSO_WEBHOOK_SECRET", "");
    expect((await pedir(firmar(cuerpo))).status).toBe(503);
  });
});
