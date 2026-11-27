import { notFound } from "next/navigation";
import { exigirCompras } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCompra } from "@/lib/compras-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { DetalleCompra } from "@/components/compras/detalle-compra";
import { datosDelEditor } from "../datos";

/** Una compra: la pre-compra para editar, o lo pedido, lo recibido, sus gastos y su liquidación. */
export default async function Page({ params }: PageProps<"/compras/[codigo]">) {
  const perfil = await exigirCompras();
  const { codigo } = await params;
  // La compra (Supabase) y los datos del editor (Odoo) no dependen entre sí:
  // se piden a la vez en vez de uno tras otro.
  const [compra, { almacenes, productos, tcSugerido }] = await Promise.all([
    cargarCompra(decodeURIComponent(codigo)),
    datosDelEditor(),
  ]);
  if (!compra) notFound();
  return (
    <DetalleCompra
      compra={compra}
      almacenes={almacenes}
      productos={productos}
      tcSugerido={tcSugerido}
      puedeCostear={ROLES[perfil.rol].verCostos}
      odooListo={odooConfigurado()}
    />
  );
}
