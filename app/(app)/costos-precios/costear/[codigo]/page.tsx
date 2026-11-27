import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirCostos } from "@/lib/sesion";
import { cargarCompra } from "@/lib/compras-servidor";
import { TIPOS_COMPRA } from "@/lib/compras";
import { cargarConfigCostos } from "@/lib/costos-servidor";
import { diaMesTexto, montoEn } from "@/lib/formato";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { EstadoCompraBadge } from "@/components/compras/estado-compra";
import { CosteoCompra } from "@/components/costos/costeo-compra";

/**
 * Costear una compra: sus gastos (flete, DAM, aduana, almacén, tráiler, mano de
 * obra…) y el primer costeo, el costo de poner cada plancha en el almacén.
 */
export default async function Page({ params }: PageProps<"/costos-precios/costear/[codigo]">) {
  await exigirCostos();
  const { codigo } = await params;
  const [compra, config] = await Promise.all([cargarCompra(decodeURIComponent(codigo)), cargarConfigCostos()]);
  if (!compra) notFound();
  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <CabeceraFormulario
        volverA="/costos-precios"
        volverTexto="Costos y precios"
        eyebrow={
          <>
            Costear · {TIPOS_COMPRA[compra.tipo]}
            <EstadoCompraBadge estado={compra.estado} />
          </>
        }
        titulo={`${compra.codigo} · ${compra.proveedor}`}
        subtitulo={
          <>
            {montoEn(compra.totalMercaderia, compra.monedaMercaderia)} de mercadería
            {compra.tcMercaderia ? ` · TC ${compra.tcMercaderia}` : ""}
            {compra.incoterm ? ` · ${compra.incoterm}` : ""}
            {compra.fechaLlegadaEstimada ? ` · llegó ${diaMesTexto(compra.fechaLlegadaEstimada, true)}` : ""} ·{" "}
            <Link href={`/compras/${compra.codigo}`} className="text-primary underline-offset-4 hover:underline">
              ver la compra
            </Link>
          </>
        }
        className="max-w-5xl"
      />
      <div className="flex max-w-5xl flex-col gap-4">
        <CosteoCompra key={`${compra.estado}-${compra.gastos.length}`} compra={compra} tarifas={config.tarifasManoObra} />
      </div>
    </div>
  );
}
