import { exigirCompras } from "@/lib/sesion";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { EditorCompra } from "@/components/compras/editor-compra";
import { datosDelEditor } from "../datos";

/** Una pre-compra nueva: lo que se le pidió (o se le va a pedir) al proveedor. */
export default async function Page() {
  await exigirCompras();
  const { almacenes, productos, tcSugerido } = await datosDelEditor();
  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <CabeceraFormulario
        volverA="/compras"
        volverTexto="Compras"
        titulo="Nueva compra"
        subtitulo="Se guarda como pre-compra. Cuando el proveedor acepte, se confirma y queda como orden de compra en Odoo."
        className="max-w-5xl"
      />
      <EditorCompra compra={null} almacenes={almacenes} productos={productos} tcSugerido={tcSugerido} odooListo={odooConfigurado()} />
    </div>
  );
}
