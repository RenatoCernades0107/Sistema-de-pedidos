import { exigirCad } from "@/lib/sesion";
import { medir } from "@/lib/tiempos";
import { listarDisenos } from "@/lib/cad/disenos-servidor";
import { listarProyectos } from "@/lib/cad/proyectos-servidor";
import { listarPlantillas } from "@/lib/cad/motor";
import type { PlantillaCad } from "@/lib/cad/tipos";
import { ListaDisenos } from "@/components/disenos/lista-disenos";

/**
 * Los proyectos y los diseños sueltos (los de un proyecto se ven dentro de él).
 * Las plantillas solo se piden para poner su nombre en
 * cada fila: si el motor CAD no responde, la lista sale igual con el código.
 */
export default async function Page() {
  await exigirCad();
  const [disenos, proyectos, plantillas] = await Promise.all([
    medir("disenos.lista", () => listarDisenos({ soloSueltos: true })),
    medir("disenos.proyectos", listarProyectos),
    medir("disenos.plantillas", listarPlantillas).catch((): PlantillaCad[] => []),
  ]);
  return <ListaDisenos disenos={disenos} proyectos={proyectos} plantillas={plantillas} />;
}
