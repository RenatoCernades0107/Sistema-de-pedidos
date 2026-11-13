import { notFound } from "next/navigation";
import { exigirCad } from "@/lib/sesion";
import { obtenerDiseno } from "@/lib/cad/disenos-servidor";
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

export default async function Page({ params }: PageProps<"/disenos/[id]">) {
  await exigirCad();
  const { id } = await params;
  const [diseno, { plantillas, aviso }] = await Promise.all([obtenerDiseno(id), plantillasDelMotor()]);
  if (!diseno) notFound();

  return (
    <DisenoProvider
      disenoId={diseno.id}
      plantillas={plantillas}
      inicial={{ plantilla: diseno.plantilla, parametros: diseno.parametros }}
    >
      <VistaDiseno disenoId={diseno.id} nombre={diseno.nombre} avisoMotor={aviso} />
    </DisenoProvider>
  );
}
