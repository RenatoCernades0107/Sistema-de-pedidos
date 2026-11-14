/**
 * Lo que la nueva cotización necesita leer de un diseño CAD para agregarlo como
 * línea. Con la sesión de quien pide: la RLS de `cad_*` solo deja a
 * Administración, así que para los demás el diseño "no existe".
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { PLANTILLA_LIBRE } from "./tipos";
import type { DisenoParaCotizar } from "./cotizar";
import type { AcomodoGrupoGuardado } from "./materiales";

export type DisenoCotizable =
  | { ok: true; diseno: DisenoParaCotizar }
  | { ok: false; error: string };

export async function disenoParaCotizar(
  disenoId: string,
  catalogo: GrupoPlancha[],
): Promise<DisenoCotizable> {
  const supabase = await clienteServidor();
  const { data: d } = await supabase
    .from("cad_disenos")
    .select("id, nombre, version_actual")
    .eq("id", disenoId)
    .maybeSingle();
  if (!d || d.version_actual === 0)
    return { ok: false, error: "No se encontró el diseño para agregarlo." };

  const { data: v, error } = await supabase
    .from("cad_diseno_versiones")
    .select("id, version, plantilla, estado, grupo_plancha_id, color, acomodo")
    .eq("diseno_id", disenoId)
    .eq("version", d.version_actual)
    .maybeSingle();
  if (error || !v)
    return {
      ok: false,
      error: "No se pudo leer la versión vigente del diseño.",
    };
  if (v.plantilla === PLANTILLA_LIBRE && v.estado !== "aprobado") {
    return {
      ok: false,
      error:
        "El diseño personalizado todavía no está aprobado: no se puede cotizar.",
    };
  }

  const acomodo = v.acomodo as { areaPiezasMm2?: unknown } | null;
  let area =
    typeof acomodo?.areaPiezasMm2 === "number" ? acomodo.areaPiezasMm2 : null;
  // Con piezas en otras planchas (material o espesor por copia), el área de la
  // línea es la de la plancha del diseño y las demás se anotan.
  const otrasPlanchas: { etiqueta: string; areaPiezasMm2: number }[] = [];
  const v2 = v.acomodo as { version?: unknown; grupos?: unknown } | null;
  if (v2?.version === 2 && Array.isArray(v2.grupos) && v2.grupos.length > 1) {
    const grupos = (v2.grupos as AcomodoGrupoGuardado[]).filter((g) => typeof g?.areaPiezasMm2 === "number");
    const propio =
      grupos.find((g) => g.grupoPlanchaId === v.grupo_plancha_id && (g.color ?? null) === (v.color ?? null)) ??
      grupos.find((g) => g.grupoPlanchaId === v.grupo_plancha_id) ??
      null;
    if (propio) {
      area = propio.areaPiezasMm2;
      for (const g of grupos) {
        if (g !== propio) otrasPlanchas.push({ etiqueta: g.etiqueta, areaPiezasMm2: g.areaPiezasMm2 });
      }
    }
  }
  return {
    ok: true,
    diseno: {
      disenoId: d.id,
      nombre: d.nombre,
      version: v.version,
      versionId: v.id,
      areaPiezasMm2: area,
      grupo: catalogo.find((g) => g.id === v.grupo_plancha_id) ?? null,
      color: v.color,
      ...(otrasPlanchas.length ? { otrasPlanchas } : {}),
    },
  };
}
