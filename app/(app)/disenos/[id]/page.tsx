import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exigirCad } from "@/lib/sesion";
import { obtenerDiseno, obtenerMaterialDiseno } from "@/lib/cad/disenos-servidor";
import { catalogoParaDiseno, plantillasDelMotor } from "@/lib/cad/pagina-servidor";
import { DisenoProvider } from "@/components/disenos/diseno-contexto";
import { VistaDiseno } from "@/components/disenos/vista-diseno";

/**
 * Un diseño: a la izquierda el menú (chat, modelo, parámetros, piezas, planchas,
 * costo) y a la derecha el modelo 3D a todo el alto. Ver `VistaDiseno`.
 */
export default async function Page({ params }: PageProps<"/disenos/[id]">) {
  const perfil = await exigirCad();
  const { id } = await params;
  const [diseno, { plantillas, aviso }, material, planchas] = await Promise.all([
    obtenerDiseno(id),
    plantillasDelMotor(),
    obtenerMaterialDiseno(id),
    catalogoParaDiseno(perfil.rol === "administracion"),
  ]);
  if (!diseno) notFound();

  return (
    <DisenoProvider
      disenoId={diseno.id}
      plantillas={plantillas}
      inicial={{ plantilla: diseno.plantilla, parametros: diseno.parametros, material }}
      catalogo={planchas.grupos}
      corte={{ kerfMm: planchas.kerfMm, margenMm: planchas.margenMm }}
      costos={planchas.costos}
    >
      <VistaDiseno
        disenoId={diseno.id}
        avisoMotor={aviso}
        cabecera={
          <>
            <Button
              render={<Link href="/disenos" />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="text-muted-foreground gap-1.5"
            >
              <ArrowLeft />
              <span className="hidden sm:inline">Diseños</span>
            </Button>
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{diseno.nombre}</h1>
          </>
        }
      />
    </DisenoProvider>
  );
}
