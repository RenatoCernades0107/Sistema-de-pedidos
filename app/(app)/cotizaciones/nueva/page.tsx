import { after } from "next/server";
import { exigirCotizaciones } from "@/lib/sesion";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { cargarCatalogoTerminados } from "@/lib/terminados-servidor";
import { calentarCatalogos } from "@/lib/odoo/catalogos";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { FormCotizacion } from "@/components/cotizaciones/form-cotizacion";
import { AvisoOdoo } from "@/components/cotizaciones/aviso-odoo";
import { lineaDeDiseno } from "@/lib/cad/cotizar";
import { disenoParaCotizar } from "@/lib/cad/cotizar-servidor";
import { catalogoParaDiseno, plantillasDelMotor } from "@/lib/cad/pagina-servidor";

/**
 * `?diseno=<id>`: viene de «Agregar a cotización» en `/disenos`. La cotización
 * arranca con ese diseño (su versión vigente) como producto terminado.
 *
 * Los productos terminados se diseñan con el motor CAD, como en `/pedidos/nuevo`.
 */
export default async function Page({ searchParams }: PageProps<"/cotizaciones/nueva">) {
  const perfil = await exigirCotizaciones();
  const disenoParam = (await searchParams).diseno;
  const disenoId = typeof disenoParam === "string" && /^[0-9a-f-]{36}$/i.test(disenoParam) ? disenoParam : null;

  if (!odooConfigurado()) {
    return (
      <div className="px-4 py-5 md:px-6 md:py-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Nueva cotización</h1>
        <AvisoOdoo className="max-w-3xl" />
      </div>
    );
  }

  // Mientras la página llega al navegador, el servidor va cargando los catálogos
  // de Odoo: así la primera búsqueda no espera la carga entera.
  after(() => calentarCatalogos());

  // Para los cortes a medida: qué planchas hay y cómo se cobra. El cálculo corre
  // en el navegador mientras se escribe; al guardar lo rehace el servidor.
  const [catalogo, config, terminados, { plantillas, aviso }, planchas] = await Promise.all([
    cargarCatalogoPlanchas(true),
    cargarConfigCortes(),
    cargarCatalogoTerminados(true),
    plantillasDelMotor(),
    catalogoParaDiseno(perfil.rol === "administracion"),
  ]);

  const desdeDiseno = disenoId ? await disenoParaCotizar(disenoId, catalogo) : null;

  return (
    <>
      {desdeDiseno && !desdeDiseno.ok && (
        <p role="alert" className="text-destructive px-4 pt-5 text-sm md:px-6">
          {desdeDiseno.error}
        </p>
      )}
      <FormCotizacion
        catalogo={catalogo}
        config={config}
        terminados={terminados}
        diseno={{
          plantillas,
          avisoMotor: aviso,
          corte: { kerfMm: planchas.kerfMm, margenMm: planchas.margenMm },
          costos: planchas.costos,
        }}
        lineaInicial={
          desdeDiseno?.ok
            ? { linea: lineaDeDiseno(desdeDiseno.diseno), disenoId: desdeDiseno.diseno.disenoId }
            : null
        }
      />
    </>
  );
}
