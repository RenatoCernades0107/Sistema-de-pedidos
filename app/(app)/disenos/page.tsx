import { exigirCad } from "@/lib/sesion";
import { listarDisenos } from "@/lib/cad/disenos-servidor";
import { listarPlantillas } from "@/lib/cad/motor";
import type { PlantillaCad } from "@/lib/cad/tipos";
import { ListaDisenos } from "@/components/disenos/lista-disenos";

/**
 * Los diseños guardados. Las plantillas solo se piden para poner su nombre en
 * cada fila: si el motor CAD no responde, la lista sale igual con el código.
 */
export default async function Page() {
  await exigirCad();
  const [disenos, plantillas] = await Promise.all([
    listarDisenos(),
    listarPlantillas().catch((): PlantillaCad[] => []),
  ]);
  return <ListaDisenos disenos={disenos} plantillas={plantillas} />;
}
