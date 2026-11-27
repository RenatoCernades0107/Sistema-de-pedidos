import { describe, expect, it } from "vitest";
import { leerAdjuntosWhatsapp, leerEventos } from "./webhook";

/** Un `whatsapp.message.received` como los de la documentación de Kapso. */
const recibido = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  message: {
    id: "wamid.1",
    timestamp: "1730092800",
    from: "51999000111",
    kapso: { direction: "inbound", origin: "cloud_api", has_media: false },
    ...message,
  },
  conversation: { id: "conv_1", contact_name: "Juan Pérez", phone_number: "51999000111", phone_number_id: "PNID" },
  phone_number_id: "PNID",
  ...extra,
});

describe("leerEventos", () => {
  it("un texto del cliente", () => {
    const [e] = leerEventos(recibido({ type: "text", text: { body: "Hola, precio del acrílico?" } }), "whatsapp.message.received");
    expect(e).toMatchObject({
      rol: "cliente",
      phoneNumberId: "PNID",
      telefono: "51999000111",
      contacto: "Juan Pérez",
      wamid: "wamid.1",
      texto: "Hola, precio del acrílico?",
      adjuntos: [],
      anuncio: null,
      creadoEn: "2024-10-28T05:20:00.000Z",
    });
  });

  it("una foto con pie: el archivo viene de kapso.media_url", () => {
    const [e] = leerEventos(
      recibido({
        type: "image",
        image: { caption: "¿Tienen de este?", id: "media_1" },
        kapso: {
          direction: "inbound",
          origin: "cloud_api",
          has_media: true,
          media_url: "https://api.kapso.ai/media/abc",
          media_data: { url: "https://api.kapso.ai/media/abc", filename: "photo.jpg", content_type: "image/jpeg", byte_size: 204800 },
        },
      }),
      "whatsapp.message.received",
    );
    expect(e.texto).toBe("¿Tienen de este?");
    expect(e.adjuntos).toEqual([
      { origen: "whatsapp", url: "https://api.kapso.ai/media/abc", nombre: "photo.jpg", mime: "image/jpeg", tamano: 204800 },
    ]);
  });

  it("una nota de voz va con su transcripción", () => {
    const [e] = leerEventos(
      recibido({
        type: "audio",
        audio: { id: "m" },
        kapso: { direction: "inbound", has_media: true, transcript: "Necesito diez planchas" },
      }),
      "whatsapp.message.received",
    );
    expect(e.texto).toBe("🎤 Nota de voz: Necesito diez planchas");
  });

  it("trae el anuncio de Meta (referral) del primer mensaje", () => {
    const [e] = leerEventos(
      recibido({
        type: "text",
        text: { body: "Hola, quiero más información" },
        referral: { source_type: "ad", source_id: "120210", headline: "Acrílico a precio de fábrica", body: "Escríbenos" },
      }),
      "whatsapp.message.received",
    );
    expect(e.anuncio).toMatchObject({ sourceId: "120210", titulo: "Acrílico a precio de fábrica" });
  });

  it("lo que el equipo responde desde la app del celular es del asesor; lo del agente (cloud_api) se ignora", () => {
    const eco = (origin: string) => ({
      message: {
        id: `wamid.${origin}`,
        timestamp: "1730092900",
        to: "51999000111",
        type: "text",
        text: { body: "Te cotizo yo" },
        kapso: { direction: "outbound", origin },
      },
      conversation: { phone_number: "51999000111" },
      phone_number_id: "PNID",
    });
    expect(leerEventos(eco("business_app"), "whatsapp.message.sent")).toMatchObject([
      { rol: "asesor", telefono: "51999000111", texto: "Te cotizo yo" },
    ]);
    expect(leerEventos(eco("cloud_api"), "whatsapp.message.sent")).toEqual([]);
  });

  it("lee los lotes (buffering) en orden, y salta reacciones y eventos sin datos", () => {
    const lote = {
      type: "whatsapp.message.received",
      batch: true,
      data: [
        recibido({ id: "wamid.b", timestamp: "1730092810", type: "text", text: { body: "segundo" } }),
        recibido({ id: "wamid.a", timestamp: "1730092800", type: "text", text: { body: "primero" } }),
        recibido({ id: "wamid.r", type: "reaction", reaction: { emoji: "👍" } }),
        { message: {} },
      ],
    };
    expect(leerEventos(lote, null).map((e) => e.texto)).toEqual(["primero", "segundo"]);
  });

  it("sin número del cliente usa el de la conversación (contactos con id de WhatsApp)", () => {
    const [e] = leerEventos(
      recibido({ from: undefined, from_user_id: undefined, type: "text", text: { body: "hola" } }),
      "whatsapp.message.received",
    );
    expect(e.telefono).toBe("51999000111");
  });
});

describe("leerAdjuntosWhatsapp", () => {
  it("solo los de WhatsApp, con su URL", () => {
    expect(
      leerAdjuntosWhatsapp([
        { origen: "whatsapp", url: "https://api.kapso.ai/media/1", nombre: "a.jpg", mime: "image/jpeg", tamano: 3 },
        { ruta: "x/y.jpg", nombre: "y.jpg" },
        { origen: "whatsapp" },
      ]),
    ).toEqual([{ origen: "whatsapp", url: "https://api.kapso.ai/media/1", nombre: "a.jpg", mime: "image/jpeg", tamano: 3 }]);
  });
});
