import { describe, expect, it } from "vitest";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import {
  aGuardado,
  aliasLibre,
  aPantalla,
  comandoEnCurso,
  contextoEncadenado,
  editar,
  enlaceDeReferencia,
  esquemaNivel,
  insertarFicha,
  partnerDeCliente,
  reemplazar,
  referenciasDe,
  sugerenciasDeContexto,
  textoDeComando,
  tipoDeComando,
  tiposQueEmpiezan,
  usaContexto,
  type Pantalla,
} from "./referencias";
import { opcionesDePlanchas } from "./referencias-planchas";
import { partirReferencias, referenciasUsadas, textoPlano, type Referencia } from "./tipos";

const juan: Referencia = { alias: "r1", tipo: "cliente", id: "1234", etiqueta: "Juan Pérez" };
const pedido: Referencia = { alias: "r2", tipo: "pedido", id: "P2611-001", etiqueta: "P2611-001" };
const ana: Referencia = { alias: "r3", tipo: "usuario", id: "u-ana", etiqueta: "Ana" };

/** Escribir al final, como un teclado. */
const teclear = (p: Pantalla, texto: string) => editar(p, p.texto + texto, p.texto.length + texto.length).pantalla;

describe("tipos.ts: partir y filtrar", () => {
  it("partirReferencias corta el texto en trozos y fichas, y deja como texto un @rN sin referencia", () => {
    expect(partirReferencias("Hola @r1, mira @r2 y @r9", [juan, pedido])).toEqual([
      "Hola ",
      juan,
      ", mira ",
      pedido,
      " y @r9",
    ]);
  });

  it("referenciasUsadas quita las que ya no están en el texto", () => {
    expect(referenciasUsadas("solo @r2", [juan, pedido])).toEqual([pedido]);
    expect(textoPlano("Hola @r1", [juan])).toBe("Hola @Juan Pérez");
  });
});

describe("comandos", () => {
  it("reconoce los comandos con tildes, mayúsculas y plurales", () => {
    expect(tipoDeComando("diseño3D")).toBe("diseno");
    expect(tipoDeComando("Diseno3d")).toBe("diseno");
    expect(tipoDeComando("pedidos")).toBe("pedido");
    expect(tipoDeComando("CLIENTE")).toBe("cliente");
    expect(tipoDeComando("pe")).toBeNull();
  });

  it("filtra los tipos por lo escrito tras la arroba", () => {
    expect(tiposQueEmpiezan("pe")).toEqual(["pedido"]);
    expect(tiposQueEmpiezan("p")).toEqual(["pedido", "plancha"]);
    expect(tiposQueEmpiezan("dise")).toEqual(["diseno"]);
    expect(tiposQueEmpiezan("")).toHaveLength(5);
    expect(tiposQueEmpiezan("xyz")).toEqual([]);
    expect(textoDeComando("diseno")).toBe("@diseno3D ");
  });
});

describe("la pantalla", () => {
  it("muestra las fichas por su etiqueta y vuelve a lo guardado sin perder nada", () => {
    const p = aPantalla("Hola @r1, mira @r2", [juan, pedido]);
    expect(p.texto).toBe("Hola @Juan Pérez, mira @P2611-001");
    expect(p.fichas.map((f) => p.texto.slice(f.inicio, f.fin))).toEqual(["@Juan Pérez", "@P2611-001"]);
    expect(aGuardado(p)).toBe("Hola @r1, mira @r2");
    expect(referenciasDe(p)).toEqual([juan, pedido]);
  });

  it("escribir antes de una ficha la corre de lugar", () => {
    const p = aPantalla("@r1 hola", [juan]);
    const { pantalla } = editar(p, "Ya @Juan Pérez hola", 3);
    expect(aGuardado(pantalla)).toBe("Ya @r1 hola");
  });

  it("borrar una letra de la ficha la quita entera", () => {
    const p = aPantalla("Hola @r1 chau", [juan]);
    // Backspace con el caret al final de "@Juan Pérez".
    const r = editar(p, "Hola @Juan Pére chau", 15);
    expect(r.pantalla.texto).toBe("Hola  chau");
    expect(r.cursor).toBe(5);
    expect(r.pantalla.fichas).toEqual([]);
    expect(aGuardado(r.pantalla)).toBe("Hola  chau");
  });

  it("escribir pegado al final de una ficha mete un espacio para no romperla", () => {
    const p = aPantalla("@r1", [juan]);
    const r = editar(p, "@Juan Pérezx", 12);
    expect(r.pantalla.texto).toBe("@Juan Pérez x");
    expect(r.cursor).toBe(13);
    expect(aGuardado(r.pantalla)).toBe("@r1 x");
  });

  it("se desambigua con el caret aunque el texto se repita", () => {
    // "@Ana" + "na": borrar la "n" de después no es borrar una letra de la ficha.
    const p = aPantalla("@r3 nana", [ana]);
    expect(p.texto).toBe("@Ana nana");
    const r = editar(p, "@Ana ana", 5);
    expect(r.pantalla.fichas).toHaveLength(1);
    expect(aGuardado(r.pantalla)).toBe("@r3 ana");
    // Con el caret dentro de la ficha, el mismo borrado se lleva la ficha entera.
    const r2 = editar(p, "@An nana", 3);
    expect(r2.pantalla).toEqual({ texto: " nana", fichas: [] });
    expect(r2.cursor).toBe(0);
  });

  it("pegar sobre una selección que cubre una ficha la reemplaza", () => {
    const p = aPantalla("a @r1 b", [juan]);
    const r = editar(p, "a XYZ b", 5);
    expect(r.pantalla.fichas).toEqual([]);
    expect(r.pantalla.texto).toBe("a XYZ b");
  });

  it("escribir dentro de una ficha sin borrar la vuelve texto", () => {
    const p = aPantalla("@r3", [ana]);
    const r = editar(p, "@Axna", 3);
    expect(r.pantalla.fichas).toEqual([]);
    expect(aGuardado(r.pantalla)).toBe("@Axna");
  });

  it("aliasLibre no pisa un @rN suelto en el texto", () => {
    expect(aliasLibre("hola @r1", [])).toBe("r2");
    expect(aliasLibre("@r1 @r2", [juan, pedido])).toBe("r3");
  });
});

describe("el @ en curso", () => {
  const sinFichas = (texto: string): Pantalla => ({ texto, fichas: [] });

  it("abre la lista de tipos tras una arroba al inicio o tras un espacio", () => {
    expect(comandoEnCurso(sinFichas("@"), 1)).toEqual({ modo: "tipos", inicio: 0, fin: 1, filtro: "" });
    expect(comandoEnCurso(sinFichas("hola @pe"), 8)).toEqual({ modo: "tipos", inicio: 5, fin: 8, filtro: "pe" });
    // Un correo no abre nada.
    expect(comandoEnCurso(sinFichas("ana@correo"), 10)).toBeNull();
  });

  it("toma el resto de la palabra si el caret está en medio", () => {
    expect(comandoEnCurso(sinFichas("@pedido"), 3)).toEqual({ modo: "tipos", inicio: 0, fin: 7, filtro: "pe" });
  });

  it("tras un comando y un espacio, lo que sigue es la consulta", () => {
    expect(comandoEnCurso(sinFichas("ver @pedido P2611"), 17)).toEqual({
      modo: "buscar",
      inicio: 4,
      fin: 17,
      tipo: "pedido",
      consulta: "P2611",
    });
    expect(comandoEnCurso(sinFichas("@cliente juan perez"), 19)).toMatchObject({ tipo: "cliente", consulta: "juan perez" });
    expect(comandoEnCurso(sinFichas("@diseño3D "), 10)).toMatchObject({ tipo: "diseno", consulta: "" });
    // Una palabra que no es comando seguida de espacio: ya no es un @.
    expect(comandoEnCurso(sinFichas("@juan perez"), 11)).toBeNull();
  });

  it("no cruza saltos de línea ni fichas", () => {
    expect(comandoEnCurso(sinFichas("@pedido\nhola"), 12)).toBeNull();
    const p = aPantalla("@r1 x", [juan]);
    expect(comandoEnCurso(p, 5)).toBeNull();
    expect(comandoEnCurso(p, 3)).toBeNull();
  });
});

describe("encadenar", () => {
  it("toma el cliente y el pedido pegados antes del @, en orden", () => {
    const p = teclear(aPantalla("Ojo @r1 @r2", [juan, pedido]), " @");
    const c = comandoEnCurso(p, p.texto.length);
    expect(c?.inicio).toBe(p.texto.length - 1);
    expect(contextoEncadenado(p, c!.inicio)).toEqual([
      { tipo: "cliente", id: "1234", etiqueta: "Juan Pérez" },
      { tipo: "pedido", id: "P2611-001", etiqueta: "P2611-001" },
    ]);
  });

  it("se corta si hay texto en medio o la ficha no encadena", () => {
    const conTexto = teclear(aPantalla("@r1 y @r2", [juan, pedido]), " @");
    expect(contextoEncadenado(conTexto, conTexto.texto.length - 1)).toEqual([
      { tipo: "pedido", id: "P2611-001", etiqueta: "P2611-001" },
    ]);
    const usuario = teclear(aPantalla("@r3", [ana]), " @");
    expect(contextoEncadenado(usuario, usuario.texto.length - 1)).toEqual([]);
  });

  it("sugiere según el contexto y dice qué tipos lo usan", () => {
    const cliente = [{ tipo: "cliente" as const, id: "1234", etiqueta: "Juan Pérez" }];
    expect(sugerenciasDeContexto(cliente).map((s) => s.texto)).toEqual(["Pedidos de Juan Pérez", "Diseños de Juan Pérez"]);
    expect(sugerenciasDeContexto([{ tipo: "pedido", id: "P1", etiqueta: "P1" }])[0].texto).toBe("Diseños del pedido P1");
    expect(usaContexto("pedido", cliente)).toBe(true);
    expect(usaContexto("plancha", cliente)).toBe(false);
  });
});

describe("insertar", () => {
  it("cambia el comando por la ficha con el siguiente alias y deja el caret detrás", () => {
    const p = { texto: "Mira @pedido P26 ya", fichas: [] };
    const ref: Referencia = { ...pedido, alias: aliasLibre("", []) };
    const { pantalla, cursor } = insertarFicha(p, 5, 16, ref);
    expect(pantalla.texto).toBe("Mira @P2611-001 ya");
    expect(cursor).toBe(16);
    expect(aGuardado(pantalla)).toBe("Mira @r1 ya");
  });

  it("al final agrega un espacio, y se puede encadenar otra", () => {
    let p = insertarFicha({ texto: "@cliente juan", fichas: [] }, 0, 13, juan).pantalla;
    expect(p.texto).toBe("@Juan Pérez ");
    p = teclear(p, "@pedido ");
    const c = comandoEnCurso(p, p.texto.length);
    expect(c).toMatchObject({ modo: "buscar", tipo: "pedido", consulta: "" });
    expect(contextoEncadenado(p, c!.inicio)).toEqual([{ tipo: "cliente", id: "1234", etiqueta: "Juan Pérez" }]);
    p = insertarFicha(p, c!.inicio, c!.fin, pedido).pantalla;
    expect(aGuardado(p)).toBe("@r1 @r2 ");
  });

  it("reemplazar corre las fichas de después", () => {
    const p = aPantalla("@pe @r1", [juan]);
    const r = reemplazar(p, 0, 3, "@pedido ");
    expect(r.texto).toBe("@pedido  @Juan Pérez");
    expect(aGuardado(r)).toBe("@pedido  @r1");
  });
});

describe("enlaces y ids", () => {
  it("pedido y diseño son enlaces; el diseño con su versión si vino de un ítem", () => {
    expect(enlaceDeReferencia(pedido)).toBe("/pedidos/P2611-001");
    expect(enlaceDeReferencia({ tipo: "diseno", id: "abc", datos: { version: 3 } })).toBe("/disenos/abc?version=3");
    expect(enlaceDeReferencia({ tipo: "diseno", id: "abc" })).toBe("/disenos/abc");
    expect(enlaceDeReferencia(juan)).toBeNull();
    expect(partnerDeCliente("1234")).toBe(1234);
    expect(partnerDeCliente("n:Juan")).toBeNull();
  });

  it("el nivel valida y trae migas vacías por defecto", () => {
    expect(esquemaNivel.parse({})).toEqual({ migas: [] });
    expect(esquemaNivel.safeParse({ grupoId: "no-uuid" }).success).toBe(false);
  });
});

// ── Planchas ────────────────────────────────────────────────────────────────

const formato = (id: string, codigo: string, anchoCm = 122, largoCm = 183) => ({
  id,
  codigo,
  anchoCm,
  largoCm,
  skuCompartido: false,
  porVerificar: false,
  nota: null,
  activo: true,
});

const grupo = (id: string, material: string, variante: string, detalle: string, espesorMm: number, formatos: ReturnType<typeof formato>[]): GrupoPlancha => ({
  id,
  material,
  variante,
  detalle,
  espesorMm,
  rotable: true,
  sobrantesActivo: false,
  formatos,
});

const G1 = "00000000-0000-4000-8000-000000000001";
const G2 = "00000000-0000-4000-8000-000000000002";
const G3 = "00000000-0000-4000-8000-000000000003";
const G4 = "00000000-0000-4000-8000-000000000004";

const catalogo: GrupoPlancha[] = [
  grupo(G1, "Acrílico ECO", "Cristal", "", 3, [formato("f1", "F7E070"), formato("f2", "F9.5E018", 122, 244)]),
  grupo(G2, "Acrílico ECO", "Cristal", "", 2.5, [formato("f3", "F7E071")]),
  grupo(G3, "Acrílico ECO", "Blanco", "Lechoso", 3, [formato("f4", "F7E080")]),
  grupo(G4, "Policarbonato sólido NAC", "Cristal", "", 3, [formato("f5", "PC3001")]),
];

describe("planchas por niveles", () => {
  const raiz = { migas: [] };

  it("sin escribir nada, la raíz son los materiales", () => {
    const o = opcionesDePlanchas(catalogo, raiz, "");
    expect(o.map((x) => x.etiqueta)).toEqual(["Acrílico ECO", "Policarbonato sólido NAC"]);
    expect(o[0].referencia).toBeUndefined();
    expect(o[0].navegable).toEqual({ material: "Acrílico ECO", migas: ["Acrílico ECO"] });
  });

  it("los colores de un material: Cristal, luego Blanco y el resto en el orden del catálogo", () => {
    const c = [
      grupo(G1, "Acrílico", "Negro", "", 3, []),
      grupo(G2, "Acrílico", "Blanco", "Lechoso", 3, []),
      grupo(G3, "Acrílico", "Colores", "Rojo", 3, []),
      grupo(G4, "Acrílico", "Cristal", "", 3, []),
    ];
    const colores = opcionesDePlanchas(c, { material: "Acrílico", migas: ["Acrílico"] }, "");
    expect(colores.map((x) => x.etiqueta)).toEqual(["Cristal", "Blanco lechoso", "Negro", "Colores rojo"]);
  });

  it("material › color › espesor › formato", () => {
    const colores = opcionesDePlanchas(catalogo, { material: "Acrílico ECO", migas: ["Acrílico ECO"] }, "");
    expect(colores.map((x) => x.etiqueta)).toEqual(["Cristal", "Blanco lechoso"]);

    const espesores = opcionesDePlanchas(catalogo, colores[0].navegable!, "", new Map([[G1, 2]]));
    expect(espesores.map((x) => x.etiqueta)).toEqual(["2.5 mm", "3 mm"]);
    // El espesor ya se puede elegir (el grupo) y también se puede entrar a sus formatos.
    const tres = espesores[1];
    expect(tres.referencia).toMatchObject({ tipo: "plancha", id: `g:${G1}`, etiqueta: "Acrílico ECO · Cristal · 3 mm" });
    expect(tres.detalle).toBe("2 formatos · 2 sobrantes");
    expect(tres.navegable).toEqual({ grupoId: G1, migas: ["Acrílico ECO", "Cristal", "3 mm"] });

    const formatos = opcionesDePlanchas(catalogo, tres.navegable!, "");
    expect(formatos.map((x) => x.etiqueta)).toEqual(["122×183 cm", "122×244 cm"]);
    expect(formatos[0].referencia).toMatchObject({
      id: "f:f1",
      etiqueta: "Acrílico ECO · Cristal · 3 mm · 122×183",
      datos: { codigo: "F7E070" },
    });
    // Filtrar dentro del grupo por medida.
    expect(opcionesDePlanchas(catalogo, tres.navegable!, "244").map((x) => x.clave)).toEqual(["f:f2"]);
  });

  it("un código de Odoo salta directo al formato, el exacto primero", () => {
    const o = opcionesDePlanchas(catalogo, raiz, "f7e07");
    expect(o.slice(0, 2).map((x) => x.clave)).toEqual(["f:f1", "f:f3"]);
    expect(opcionesDePlanchas(catalogo, raiz, "F7E080")[0].clave).toBe("f:f4");
  });

  it('"3mm cristal" salta a los grupos de ese espesor y color', () => {
    const o = opcionesDePlanchas(catalogo, raiz, "3mm cristal");
    expect(o.map((x) => x.clave)).toEqual([`g:${G1}`, `g:${G4}`]);
    // "transparente" es como el cliente dice "cristal".
    expect(opcionesDePlanchas(catalogo, raiz, "transparente 2.5").map((x) => x.clave)).toEqual([`g:${G2}`]);
  });

  it("sin espesor, lo escrito ofrece entrar al material o al color, y lista los grupos", () => {
    const o = opcionesDePlanchas(catalogo, raiz, "eco lechoso");
    expect(o[0]).toMatchObject({ etiqueta: "Acrílico ECO · Blanco lechoso", navegable: { material: "Acrílico ECO", color: "Blanco lechoso" } });
    expect(o.at(-1)?.clave).toBe(`g:${G3}`);
    expect(opcionesDePlanchas(catalogo, raiz, "policarbonato")[0]).toMatchObject({ clave: "m:Policarbonato sólido NAC" });
  });
});
