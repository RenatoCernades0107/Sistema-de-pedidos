import { describe, expect, it } from "vitest";
import {
  agruparConversaciones,
  duracionTexto,
  horaCorta,
  infoDeLecturas,
  mimeDeArchivo,
  noLeidos,
  pesoTexto,
  rutaArchivoChat,
  unirLecturas,
  unirMensajes,
  validarArchivoChat,
  vistaPrevia,
} from "./logica";
import { estadoDeEntrega, type Adjunto, type Mensaje, type Participante, type ResumenConversacion } from "./tipos";

const resumen = (parcial: Partial<ResumenConversacion> & Pick<ResumenConversacion, "id" | "tipo" | "nombre">) =>
  ({
    descripcion: null,
    pedidoId: null,
    pedidoCodigo: null,
    otroUsuarioId: null,
    otroUsuarioRol: null,
    miembros: 0,
    ultimoMensajeEn: null,
    ultimoTexto: null,
    ultimoAutor: null,
    ultimoAutorId: null,
    ultimoAdjuntos: 0,
    sinLeer: 0,
    mencionesSinLeer: 0,
    ...parcial,
  }) satisfies ResumenConversacion;

const mensaje = (id: string, autorId: string, creadoEn: string, adjuntos: Adjunto[] = []): Mensaje => ({
  id,
  conversacionId: "c",
  autorId,
  autor: autorId,
  rol: null,
  texto: id,
  referencias: [],
  creadoEn,
  adjuntos,
});

const participante = (usuarioId: string, desde = "2026-01-01T00:00:00Z"): Participante => ({
  usuarioId,
  nombre: usuarioId,
  rol: "logistica",
  desde,
});

describe("agruparConversaciones", () => {
  const lista = [
    resumen({ id: "p", tipo: "pedido", nombre: "Pedido P2611-001", ultimoMensajeEn: "2026-11-10T10:00:00Z" }),
    resumen({ id: "d1", tipo: "directo", nombre: "Carla", ultimoMensajeEn: "2026-11-10T09:00:00Z" }),
    resumen({ id: "d2", tipo: "directo", nombre: "Miguel", ultimoMensajeEn: "2026-11-11T09:00:00Z" }),
    resumen({ id: "g", tipo: "general", nombre: "General" }),
    resumen({ id: "c1", tipo: "canal", nombre: "Taller" }),
    resumen({ id: "c2", tipo: "canal", nombre: "Despachos", ultimoMensajeEn: "2026-11-01T00:00:00Z" }),
  ];

  it("pone General arriba y ordena cada grupo por actividad", () => {
    const grupos = agruparConversaciones(lista);
    expect(grupos.map((g) => g.tipo)).toEqual(["general", "canal", "directo", "pedido"]);
    expect(grupos[1].conversaciones.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(grupos[2].conversaciones.map((c) => c.id)).toEqual(["d2", "d1"]);
  });

  it("filtra sin tildes y quita los grupos vacíos", () => {
    const grupos = agruparConversaciones(
      [...lista, resumen({ id: "c3", tipo: "canal", nombre: "Logística" })],
      "logist",
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].conversaciones[0].id).toBe("c3");
  });
});

describe("vistaPrevia", () => {
  const base = resumen({ id: "c", tipo: "canal", nombre: "Taller", ultimoMensajeEn: "2026-11-10T10:00:00Z" });

  it("dice quién escribió", () => {
    expect(vistaPrevia({ ...base, ultimoTexto: "Listo", ultimoAutor: "Carla Ruiz", ultimoAutorId: "u2" }, "u1")).toBe(
      "Carla: Listo",
    );
    expect(vistaPrevia({ ...base, ultimoTexto: "Listo", ultimoAutorId: "u1" }, "u1")).toBe("Tú: Listo");
  });

  it("cuenta los archivos si no hay texto", () => {
    expect(vistaPrevia({ ...base, ultimoTexto: "", ultimoAdjuntos: 3, ultimoAutorId: "u1" }, "u1")).toBe(
      "Tú: 📎 3 archivos",
    );
  });

  it("sin mensajes muestra la descripción", () => {
    expect(vistaPrevia({ ...base, ultimoMensajeEn: null, descripcion: "Del taller" }, "u1")).toBe("Del taller");
  });
});

describe("horaCorta", () => {
  it("hora si es hoy, ayer, o la fecha", () => {
    expect(horaCorta("2026-11-16T14:05", "2026-11-16")).toBe("14:05");
    expect(horaCorta("2026-11-15T14:05", "2026-11-16")).toBe("ayer");
    expect(horaCorta("2026-03-01T09:00", "2026-03-02")).toBe("ayer");
    expect(horaCorta("2026-10-02T09:00", "2026-11-16")).toBe("02/10");
    expect(horaCorta("2025-10-02T09:00", "2026-11-16")).toBe("02/10/25");
  });
});

describe("archivos", () => {
  it("adivina el tipo por la extensión solo si el navegador no lo dio", () => {
    expect(mimeDeArchivo({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
    expect(mimeDeArchivo({ name: "video.mov", type: "application/octet-stream" })).toBe("video/quicktime");
    expect(mimeDeArchivo({ name: "foto.jpg", type: "image/jpeg" })).toBe("image/jpeg");
    expect(mimeDeArchivo({ name: "a.docx", type: "application/vnd.openxmlformats" })).toBeNull();
    expect(mimeDeArchivo({ name: "a.pdf.exe", type: "" })).toBeNull();
  });

  it("valida tipo, vacío y 50 MB", () => {
    expect(validarArchivoChat({ name: "a.pdf", type: "application/pdf", size: 10 })).toBeNull();
    expect(validarArchivoChat({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatch(/vacío/);
    expect(validarArchivoChat({ name: "a.zip", type: "application/zip", size: 10 })).toMatch(/solo fotos/);
    expect(validarArchivoChat({ name: "v.mp4", type: "video/mp4", size: 51 * 1024 * 1024 })).toMatch(/50 MB/);
  });

  it("arma la ruta del bucket sin dejar salir de la carpeta", () => {
    expect(rutaArchivoChat("c1", "u1", "../Plano Ñandú.PDF")).toBe("conversaciones/c1/u1-plano-nandu.pdf");
  });

  it("formatea peso y duración", () => {
    expect(pesoTexto(860160)).toBe("840 KB");
    expect(pesoTexto(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(duracionTexto(75.4)).toBe("1:15");
    expect(duracionTexto(3725)).toBe("1:02:05");
    expect(duracionTexto(null)).toBe("");
  });
});

describe("unirMensajes", () => {
  const adj: Adjunto = {
    id: "a1",
    mensajeId: "m2",
    ruta: "conversaciones/c/x-a.jpg",
    nombre: "a.jpg",
    mime: "image/jpeg",
    tamano: 1,
    ancho: null,
    alto: null,
    duracionS: null,
    posicion: 0,
  };

  it("no repite y ordena por fecha", () => {
    const a = [mensaje("m1", "u1", "2026-11-10T10:00:00Z")];
    const b = unirMensajes(a, [mensaje("m0", "u1", "2026-11-10T09:00:00Z"), mensaje("m1", "u1", "2026-11-10T10:00:00Z")]);
    expect(b.map((m) => m.id)).toEqual(["m0", "m1"]);
  });

  it("devuelve la misma lista si no hay nada nuevo", () => {
    const a = [mensaje("m1", "u1", "2026-11-10T10:00:00Z")];
    expect(unirMensajes(a, [mensaje("m1", "u1", "2026-11-10T10:00:00.000+00:00")])).toBe(a);
  });

  it("completa los adjuntos de un mensaje que llegó antes que ellos", () => {
    const a = [mensaje("m2", "u1", "2026-11-10T10:00:00Z")];
    const b = unirMensajes(a, [mensaje("m2", "u1", "2026-11-10T10:00:00Z", [adj])]);
    expect(b[0].adjuntos).toHaveLength(1);
  });
});

describe("lecturas", () => {
  const participantes = [
    participante("yo"),
    participante("carla"),
    participante("miguel"),
    participante("nuevo", "2026-11-12T00:00:00Z"),
  ];
  const m = mensaje("m1", "yo", "2026-11-10T10:00:00Z");

  it("no repite lecturas", () => {
    const l = [{ mensajeId: "m1", usuarioId: "carla", leidoEn: "2026-11-10T10:01:00Z" }];
    expect(unirLecturas(l, l)).toBe(l);
    expect(unirLecturas(l, [{ mensajeId: "m1", usuarioId: "miguel", leidoEn: "x" }])).toHaveLength(2);
  });

  it("el doble check azul pide a todos los destinatarios de ese momento", () => {
    const una = [{ mensajeId: "m1", usuarioId: "carla", leidoEn: "2026-11-10T10:01:00Z" }];
    expect(estadoDeEntrega(m, participantes, una)).toBe("enviado");
    const dos = [...una, { mensajeId: "m1", usuarioId: "miguel", leidoEn: "2026-11-10T10:00:30Z" }];
    // "nuevo" entró después: no cuenta.
    expect(estadoDeEntrega(m, participantes, dos)).toBe("visto");
  });

  it("separa visto por (en orden) y falta ver", () => {
    const l = [
      { mensajeId: "m1", usuarioId: "carla", leidoEn: "2026-11-10T10:05:00Z" },
      { mensajeId: "m1", usuarioId: "nuevo", leidoEn: "2026-11-12T10:05:00Z" },
    ];
    const info = infoDeLecturas(m, participantes, l);
    expect(info.vistoPor.map((v) => v.participante.usuarioId)).toEqual(["carla"]);
    expect(info.faltan.map((p) => p.usuarioId)).toEqual(["miguel"]);
  });

  it("cuenta los no leídos ajenos desde que la persona participa", () => {
    const mensajes = [
      mensaje("a", "carla", "2026-11-01T00:00:00Z"),
      mensaje("b", "carla", "2026-11-10T00:00:00Z"),
      mensaje("c", "yo", "2026-11-10T01:00:00Z"),
      mensaje("d", "miguel", "2026-11-10T02:00:00Z"),
    ];
    const l = [{ mensajeId: "b", usuarioId: "yo", leidoEn: "x" }];
    expect(noLeidos(mensajes, l, "yo", null)).toBe(2);
    expect(noLeidos(mensajes, l, "yo", "2026-11-05T00:00:00Z")).toBe(1);
  });
});
