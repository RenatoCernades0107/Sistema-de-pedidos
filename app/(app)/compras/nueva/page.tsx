import { exigirCompras } from "@/lib/sesion";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { EditorCompra } from "@/components/compras/editor-compra";
import { abrirBorrador, cargarBorradores } from "@/lib/borradores-servidor";
import { AvisoBorradorVencido } from "@/components/borradores/aviso-borrador";
import { ListaBorradores } from "@/components/borradores/lista-borradores";
import { datosDelEditor } from "../datos";

/** Una pre-compra nueva: lo que se le pidió (o se le va a pedir) al proveedor. */
export default async function Page({ searchParams }: PageProps<"/compras/nueva">) {
  await exigirCompras();
  const { borrador: idBorrador } = await searchParams;
  const [{ almacenes, productos, tcSugerido }, borrador] = await Promise.all([
    datosDelEditor(),
    // Retomar un borrador: el formulario arranca como quedó.
    typeof idBorrador === "string" ? abrirBorrador(idBorrador, "compra") : Promise.resolve(null),
  ]);
  // Sin borrador abierto, se ofrecen los que quedaron a medias.
  const pendientes = borrador ? [] : await cargarBorradores("compra");
  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      {typeof idBorrador === "string" && !borrador && <AvisoBorradorVencido />}
      <div className="max-w-5xl">
        <ListaBorradores borradores={pendientes} nombre="compra" />
      </div>
      <CabeceraFormulario
        volverA="/compras"
        volverTexto="Compras"
        titulo="Nueva compra"
        subtitulo="Se guarda como pre-compra. Cuando el proveedor acepte, se confirma y queda como orden de compra en Odoo."
        className="max-w-5xl"
      />
      <EditorCompra key={borrador?.id ?? "nueva"} borrador={borrador} compra={null} almacenes={almacenes} productos={productos} tcSugerido={tcSugerido} odooListo={odooConfigurado()} />
    </div>
  );
}
