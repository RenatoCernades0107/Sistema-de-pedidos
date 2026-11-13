/**
 * Lo que la nueva cotización necesita leer de un diseño CAD para agregarlo como
 * línea. Con la sesión de quien pide: la RLS de `cad_*` solo deja a
 * Administración, así que para los demás el diseño "no existe".
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { PLANTILLA_LIBRE } from "./tipos";
import type { DisenoParaCotizar } from "./cotizar";

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
  const area =
    typeof acomodo?.areaPiezasMm2 === "number" ? acomodo.areaPiezasMm2 : null;
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
    },
  };
}
