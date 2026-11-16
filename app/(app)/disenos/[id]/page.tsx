import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exigirCad } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { obtenerDiseno, obtenerMaterialDiseno, obtenerMaterialesPorCopia } from "@/lib/cad/disenos-servidor";
import { catalogoParaDiseno, plantillasDelMotor } from "@/lib/cad/pagina-servidor";
import { DisenoProvider } from "@/components/disenos/diseno-contexto";
import { BOTON_CABECERA } from "@/components/disenos/estilos";
import { VistaDiseno } from "@/components/disenos/vista-diseno";

/** Un número de versión de la URL (`?version=12`), o `null` si no hay o no es válido. */
function versionDeUrl(valor: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(valor) ? valor[0] : valor);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Un diseño: a la izquierda el menú (chat, modelo, parámetros, piezas, planchas,
 * costo, historial) y a la derecha el modelo 3D a todo el alto. Ver `VistaDiseno`.
 *
 * Lo abren los tres roles. El costo (precios de Odoo) solo lo ve quien ve montos,
 * y aprobar un diseño libre para producción sigue siendo de Administración.
 *
 * `?historial=1` abre con el historial (el aviso "cambiaron tu diseño");
 * `?version=N`, además, con esa versión en vista previa.
 */
export default async function Page({ params, searchParams }: PageProps<"/disenos/[id]">) {
  const perfil = await exigirCad();
  const [{ id }, consulta] = await Promise.all([params, searchParams]);
  const verMontos = ROLES[perfil.rol].verMontos;
  const [diseno, { plantillas, aviso }, material, materiales, planchas] = await Promise.all([
    obtenerDiseno(id),
    plantillasDelMotor(),
    obtenerMaterialDiseno(id),
    obtenerMaterialesPorCopia(id),
    catalogoParaDiseno(verMontos),
  ]);
  if (!diseno) notFound();

  return (
    <DisenoProvider
      disenoId={diseno.id}
      plantillas={plantillas}
      inicial={{ plantilla: diseno.plantilla, parametros: diseno.parametros, material, materiales }}
      catalogo={planchas.grupos}
      corte={{ kerfMm: planchas.kerfMm, margenMm: planchas.margenMm }}
      costos={planchas.costos}
      versionInicial={diseno.version}
      usuario={{ id: perfil.id, puedeAprobar: perfil.rol === "administracion" }}
    >
      <VistaDiseno
        disenoId={diseno.id}
        avisoMotor={aviso}
        nombreDiseno={diseno.nombre}
        vigenteConFoto={diseno.miniatura !== null}
        conHistorial
        abrirHistorial={consulta.historial === "1"}
        verVersion={versionDeUrl(consulta.version)}
        verCosto={verMontos}
        volver={
          <Button
            render={<Link href="/disenos" />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className={BOTON_CABECERA}
          >
            <ArrowLeft />
            <span className="hidden sm:inline">Diseños</span>
          </Button>
        }
      />
    </DisenoProvider>
  );
}
