import { after } from "next/server";
import { exigirCotizaciones } from "@/lib/sesion";
import { calentarCatalogos } from "@/lib/odoo/catalogos";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { FormCotizacion } from "@/components/cotizaciones/form-cotizacion";
import { AvisoOdoo } from "@/components/cotizaciones/aviso-odoo";

export default async function Page() {
  await exigirCotizaciones();

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

  return <FormCotizacion />;
}
