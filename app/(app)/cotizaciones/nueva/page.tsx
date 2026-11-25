import { after } from "next/server";
import { exigirCotizaciones } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { cargarCatalogoTerminados } from "@/lib/terminados-servidor";
import { calentarCatalogos } from "@/lib/odoo/catalogos";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { FormCotizacion } from "@/components/cotizaciones/form-cotizacion";
import { AvisoOdoo } from "@/components/cotizaciones/aviso-odoo";
import { lineaDeDiseno } from "@/lib/cad/cotizar";
import { disenoParaCotizar } from "@/lib/cad/cotizar-servidor";
import { catalogoParaDiseno, plantillasDelMotor } from "@/lib/cad/pagina-servidor";
import { abrirBorrador } from "@/lib/borradores-servidor";
import { AvisoBorradorVencido } from "@/components/borradores/aviso-borrador";

/**
 * `?diseno=<id>`: viene de «Agregar a cotización» en `/disenos`. La cotización
 * arranca con ese diseño (su versión vigente) como producto terminado.
 *
 * Los productos terminados se diseñan con el motor CAD, como en `/pedidos/nuevo`.
 */
export default async function Page({ searchParams }: PageProps<"/cotizaciones/nueva">) {
  const perfil = await exigirCotizaciones();
  const { diseno: disenoParam, borrador: borradorParam } = await searchParams;
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
    catalogoParaDiseno(ROLES[perfil.rol].verPrecios),
  ]);

  // Retomar un borrador: arranca como quedó. Su diseño ya está entre sus líneas,
  // así que `?diseno=` (que queda en la URL) no se vuelve a agregar.
  const borrador = typeof borradorParam === "string" ? await abrirBorrador(borradorParam, "cotizacion") : null;
  const borradorPerdido = typeof borradorParam === "string" && !borrador;
  const desdeDiseno = disenoId && !borrador ? await disenoParaCotizar(disenoId, catalogo) : null;

  return (
    <>
      {borradorPerdido && <AvisoBorradorVencido />}
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
          corte: { kerfMm: planchas.kerfMm, margenMm: planchas.margenMm, politica: planchas.politica },
          costos: planchas.costos,
        }}
        key={borrador?.id ?? "nueva"}
        borrador={borrador}
        lineaInicial={
          desdeDiseno?.ok
            ? { linea: lineaDeDiseno(desdeDiseno.diseno), disenoId: desdeDiseno.diseno.disenoId }
            : null
        }
      />
    </>
  );
}
