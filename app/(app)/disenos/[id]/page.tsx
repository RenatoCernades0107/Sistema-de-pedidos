import { notFound } from "next/navigation";
import { exigirCad } from "@/lib/sesion";
import { obtenerDiseno, obtenerMaterialDiseno } from "@/lib/cad/disenos-servidor";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { ErrorMotorCad, listarPlantillas } from "@/lib/cad/motor";
import type { PlantillaCad } from "@/lib/cad/tipos";
import { DisenoProvider } from "@/components/disenos/diseno-contexto";
import { VistaDiseno } from "@/components/disenos/vista-diseno";

/**
 * Un diseño: el chat con el asistente a la izquierda y, a la derecha, el render
 * con sus parámetros, su despiece y sus descargas.
 *
 * El motor CAD es un servicio aparte y puede no estar: en ese caso la página se
 * pinta igual —el chat y lo guardado siguen ahí— con el motivo a la vista, en
 * vez de caer en el límite de error de `(app)`.
 */
async function plantillasDelMotor(): Promise<{ plantillas: PlantillaCad[]; aviso: string | null }> {
  try {
    return { plantillas: await listarPlantillas(), aviso: null };
  } catch (e) {
    if (!(e instanceof ErrorMotorCad)) throw e;
    console.error("[cad] plantillas", e.estado, e.codigo, e.message);
    return { plantillas: [], aviso: e.message };
  }
}

/** El catálogo de planchas para elegir el material. Sin él, el diseño se usa igual. */
async function catalogo(): Promise<{ grupos: GrupoPlancha[]; kerfMm: number; margenMm: number }> {
  try {
    const [grupos, config] = await Promise.all([cargarCatalogoPlanchas(true), cargarConfigCortes()]);
    // La configuración de cortes está en cm; el diseño, en mm.
    return { grupos, kerfMm: config.corte.kerfLaser * 10, margenMm: config.corte.margen * 10 };
  } catch (e) {
    console.error("[cad] catálogo de planchas", e);
    return { grupos: [], kerfMm: 0, margenMm: 0 };
  }
}

export default async function Page({ params }: PageProps<"/disenos/[id]">) {
  await exigirCad();
  const { id } = await params;
  const [diseno, { plantillas, aviso }, material, planchas] = await Promise.all([
    obtenerDiseno(id),
    plantillasDelMotor(),
    obtenerMaterialDiseno(id),
    catalogo(),
  ]);
  if (!diseno) notFound();

  return (
    <DisenoProvider
      disenoId={diseno.id}
      plantillas={plantillas}
      inicial={{ plantilla: diseno.plantilla, parametros: diseno.parametros, material }}
      catalogo={planchas.grupos}
      corte={{ kerfMm: planchas.kerfMm, margenMm: planchas.margenMm }}
    >
      <VistaDiseno disenoId={diseno.id} nombre={diseno.nombre} avisoMotor={aviso} />
    </DisenoProvider>
  );
}
