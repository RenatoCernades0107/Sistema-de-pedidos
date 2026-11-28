/**
 * `@plancha`: navegar el catálogo de planchas por niveles, o saltar directo.
 *
 * Quien está en el taller piensa la plancha como se guarda: material › color ›
 * espesor › formato. El menú baja por esos niveles; en el nivel del espesor ya
 * se puede elegir el grupo (material + color + espesor, lo que pide el cliente)
 * o entrar a sus formatos. Y quien ya sabe lo que quiere lo escribe: un código
 * de Odoo (`F7E070`) o "3mm cristal" van directo al formato o al grupo.
 *
 * Puro: recibe el catálogo ya cargado (`cargarCatalogoPlanchas`) y los
 * sobrantes disponibles por grupo, y se prueba con datos de ejemplo.
 */

import { compactar, normalizarTexto, SINONIMOS } from "@/lib/busqueda-inteligente";
import { colorDe, espesorTexto, medidaDe, nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { porPrioridadDeColor } from "@/lib/cortes/seleccion-material";
import { recortar, type NivelReferencia, type OpcionReferencia, type ReferenciaNueva } from "./referencias";

const LIMITE = 20;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const textoSobrantes = (n: number) => (n > 0 ? ` · ${plural(n, "sobrante", "sobrantes")}` : "");

/** La referencia a un grupo: `g:<id>`. */
export function referenciaDeGrupo(g: GrupoPlancha): ReferenciaNueva {
  return {
    tipo: "plancha",
    id: `g:${g.id}`,
    etiqueta: recortar(nombreDeGrupo(g)),
    detalle: plural(g.formatos.length, "formato", "formatos"),
    datos: { material: g.material, color: colorDe(g), espesorMm: g.espesorMm },
  };
}

/** La referencia a un formato: `f:<id>`, con su código de Odoo. */
export function referenciaDeFormato(g: GrupoPlancha, f: GrupoPlancha["formatos"][number]): ReferenciaNueva {
  return {
    tipo: "plancha",
    id: `f:${f.id}`,
    etiqueta: recortar(`${nombreDeGrupo(g)} · ${medidaDe(f)}`),
    detalle: recortar(`Código ${f.codigo} · ${medidaDe(f)} cm`, 200),
    datos: {
      codigo: f.codigo,
      material: g.material,
      color: colorDe(g),
      espesorMm: g.espesorMm,
      medida: medidaDe(f),
      grupoId: g.id,
    },
  };
}

const opcionGrupo = (g: GrupoPlancha, sobrantes: number, migas: string[], etiqueta?: string): OpcionReferencia => ({
  clave: `g:${g.id}`,
  etiqueta: etiqueta ?? nombreDeGrupo(g),
  detalle: plural(g.formatos.length, "formato", "formatos") + textoSobrantes(sobrantes),
  referencia: referenciaDeGrupo(g),
  navegable: g.formatos.length ? { grupoId: g.id, migas: [...migas, espesorTexto(g.espesorMm)] } : undefined,
});

const opcionFormato = (g: GrupoPlancha, f: GrupoPlancha["formatos"][number], corta: boolean): OpcionReferencia => ({
  clave: `f:${f.id}`,
  etiqueta: corta ? `${medidaDe(f)} cm` : `${nombreDeGrupo(g)} · ${medidaDe(f)}`,
  detalle: `Código ${f.codigo}${f.porVerificar ? " · por verificar" : ""}`,
  referencia: referenciaDeFormato(g, f),
});

/** Las palabras de la consulta, cada una con sus sinónimos ("transparente" → "cristal"). */
function palabrasConSinonimos(q: string): string[][] {
  const n = normalizarTexto(q);
  return (n ? n.split(" ") : []).map((p) => [p, ...(SINONIMOS[p] ?? [])]);
}

/** Cada palabra (o un sinónimo) empieza alguna palabra del texto. */
function coinciden(texto: string, palabras: string[][]): boolean {
  const objetivo = normalizarTexto(texto).split(" ");
  return palabras.every((alternativas) => alternativas.some((p) => objetivo.some((o) => o.startsWith(p))));
}

/** Un número en la consulta es un espesor: "3mm", "2.5 mm", "cristal 3". */
function espesoresDe(q: string): number[] {
  return [...q.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:mm)?/gi)].map((m) => Number(m[1].replace(",", "."))).filter((n) => n > 0);
}

/** La consulta sin los espesores, para comparar lo demás con material y color. */
const sinEspesores = (q: string) => q.replace(/\d+(?:[.,]\d+)?\s*(?:mm\b)?/gi, " ");

/** Los materiales en el orden del catálogo, sin repetir. */
const materialesDe = (catalogo: GrupoPlancha[]) => [...new Set(catalogo.map((g) => g.material))];

/** Los colores de un material: Cristal, luego Blanco y el resto en el orden del catálogo. */
const coloresDe = (catalogo: GrupoPlancha[], material: string) =>
  [...new Set(catalogo.filter((g) => g.material === material).map((g) => colorDe(g)))].sort(porPrioridadDeColor);

export interface ResultadoPlanchas {
  opciones: OpcionReferencia[];
}

/**
 * Las opciones del menú para `@plancha` en un nivel y con lo escrito.
 * `sobrantes`: los retazos disponibles por id de grupo (opcional).
 */
export function opcionesDePlanchas(
  catalogo: GrupoPlancha[],
  nivel: NivelReferencia,
  q: string,
  sobrantes: ReadonlyMap<string, number> = new Map(),
): OpcionReferencia[] {
  const consulta = q.trim();
  const migas = nivel.migas ?? [];
  const sob = (id: string) => sobrantes.get(id) ?? 0;

  // ── Un grupo: sus formatos.
  if (nivel.grupoId) {
    const g = catalogo.find((x) => x.id === nivel.grupoId);
    if (!g) return [];
    const c = compactar(consulta);
    return g.formatos
      .filter((f) => !c || compactar(f.codigo).includes(c) || compactar(medidaDe(f)).includes(c))
      .map((f) => opcionFormato(g, f, true));
  }

  // ── Material y color: los espesores (cada uno es un grupo, que ya se puede elegir).
  if (nivel.material && nivel.color) {
    const espesores = espesoresDe(consulta);
    return catalogo
      .filter((g) => g.material === nivel.material && colorDe(g) === nivel.color)
      .filter((g) => !espesores.length || espesores.includes(g.espesorMm))
      .sort((a, b) => a.espesorMm - b.espesorMm)
      .map((g) => opcionGrupo(g, sob(g.id), migas, espesorTexto(g.espesorMm)));
  }

  // ── Un material: sus colores.
  if (nivel.material) {
    const material = nivel.material;
    const palabras = palabrasConSinonimos(consulta);
    return coloresDe(catalogo, material)
      .filter((color) => coinciden(color, palabras))
      .map((color) => {
        const grupos = catalogo.filter((g) => g.material === material && colorDe(g) === color);
        return {
          clave: `c:${material}:${color}`,
          etiqueta: color,
          detalle: grupos.map((g) => espesorTexto(g.espesorMm)).join(", "),
          navegable: { material, color, migas: [material, color] },
        };
      });
  }

  // ── La raíz sin escribir nada: los materiales.
  if (!consulta) {
    return materialesDe(catalogo).map((material) => ({
      clave: `m:${material}`,
      etiqueta: material,
      detalle: plural(coloresDe(catalogo, material).length, "color", "colores"),
      navegable: { material, migas: [material] },
    }));
  }

  // ── La raíz con algo escrito: códigos, luego grupos y, sin espesor, materiales y colores.
  const opciones: OpcionReferencia[] = [];
  const c = compactar(consulta);

  // Un código de Odoo: exacto primero, después los que empiezan así.
  if (/\d/.test(c) && c.length >= 2) {
    const porCodigo: { g: GrupoPlancha; f: GrupoPlancha["formatos"][number]; exacto: boolean }[] = [];
    for (const g of catalogo) {
      for (const f of g.formatos) {
        const codigo = compactar(f.codigo);
        if (codigo.startsWith(c)) porCodigo.push({ g, f, exacto: codigo === c });
      }
    }
    porCodigo.sort((a, b) => Number(b.exacto) - Number(a.exacto) || a.f.codigo.localeCompare(b.f.codigo));
    opciones.push(...porCodigo.map(({ g, f }) => opcionFormato(g, f, false)));
  }

  const espesores = espesoresDe(consulta);
  const palabras = palabrasConSinonimos(sinEspesores(consulta));
  if (palabras.length || espesores.length) {
    const grupos = catalogo
      .filter((g) => (!espesores.length || espesores.includes(g.espesorMm)) && coinciden(`${g.material} ${colorDe(g)}`, palabras))
      .sort((a, b) => a.material.localeCompare(b.material) || colorDe(a).localeCompare(colorDe(b)) || a.espesorMm - b.espesorMm);

    if (!espesores.length) {
      // Sin espesor, lo escrito puede ser un material ("eco") o un color ("cristal"): se ofrece entrar.
      for (const material of materialesDe(catalogo)) {
        if (palabras.length && coinciden(material, palabras)) {
          opciones.push({
            clave: `m:${material}`,
            etiqueta: material,
            detalle: plural(coloresDe(catalogo, material).length, "color", "colores"),
            navegable: { material, migas: [material] },
          });
        }
      }
      const colores = new Map<string, { material: string; color: string }>();
      for (const g of grupos) colores.set(`${g.material}\u0000${colorDe(g)}`, { material: g.material, color: colorDe(g) });
      for (const { material, color } of colores.values()) {
        opciones.push({
          clave: `c:${material}:${color}`,
          etiqueta: `${material} · ${color}`,
          detalle: "Ver espesores",
          navegable: { material, color, migas: [material, color] },
        });
      }
    }
    opciones.push(...grupos.map((g) => opcionGrupo(g, sob(g.id), [g.material, colorDe(g)])));
  }

  const vistas = new Set<string>();
  return opciones.filter((o) => !vistas.has(o.clave) && vistas.add(o.clave)).slice(0, LIMITE);
}
