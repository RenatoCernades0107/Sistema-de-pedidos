import { notFound } from "next/navigation";
import { exigirCad } from "@/lib/sesion";
import { listarPlantillas } from "@/lib/cad/motor";
import { obtenerProyecto } from "@/lib/cad/proyectos-servidor";
import type { PlantillaCad } from "@/lib/cad/tipos";
import { VistaProyecto } from "@/components/disenos/vista-proyecto";

/**
 * Un proyecto: los diseños de un mismo trabajo como tarjetas. Lo abren los tres
 * roles; aprobar todo es de Administración (la base lo vuelve a exigir).
 */
export default async function Page({ params }: PageProps<"/disenos/proyectos/[id]">) {
  const perfil = await exigirCad();
  const { id } = await params;
  const [proyecto, plantillas] = await Promise.all([
    obtenerProyecto(id),
    listarPlantillas().catch((): PlantillaCad[] => []),
  ]);
  if (!proyecto) notFound();

  return (
    <VistaProyecto
      proyecto={{ id: proyecto.id, nombre: proyecto.nombre }}
      disenos={proyecto.disenos}
      resumen={proyecto.resumen}
      plantillas={plantillas}
      puedeAprobar={perfil.rol === "administracion"}
    />
  );
}
