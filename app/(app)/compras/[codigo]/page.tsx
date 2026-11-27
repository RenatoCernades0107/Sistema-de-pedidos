import { notFound } from "next/navigation";
import { exigirCompras } from "@/lib/sesion";
import { cargarCompra } from "@/lib/compras-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { DetalleCompra } from "@/components/compras/detalle-compra";
import { datosDelEditor } from "../datos";

/** Una compra: la pre-compra para editar, o lo pedido, lo recibido, sus gastos y su liquidación. */
export default async function Page({ params }: PageProps<"/compras/[codigo]">) {
  await exigirCompras();
  const { codigo } = await params;
  const compra = await cargarCompra(decodeURIComponent(codigo));
  if (!compra) notFound();
  const { almacenes, productos, tcSugerido, tarifas } = await datosDelEditor();
  return (
    <DetalleCompra
      compra={compra}
      almacenes={almacenes}
      productos={productos}
      tcSugerido={tcSugerido}
      tarifas={tarifas}
      odooListo={odooConfigurado()}
    />
  );
}
