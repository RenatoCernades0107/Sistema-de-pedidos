import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { exigirSesion } from "@/lib/sesion";
import { cargarSobrante } from "@/lib/sobrantes-servidor";
import { EtiquetaSobrante } from "@/components/sobrantes/etiqueta-sobrante";

/**
 * La etiqueta de un sobrante, para pegarla en la pieza. El QR lleva el código,
 * que es el nombre del lote en Odoo: escanearlo en Odoo encuentra la pieza.
 *
 * El QR se dibuja aquí, en el servidor, como SVG: nítido a cualquier tamaño y
 * sin cargar la librería en el navegador.
 */
export default async function Page({ params }: PageProps<"/sobrantes/[codigo]/etiqueta">) {
  await exigirSesion();
  const codigo = decodeURIComponent((await params).codigo);
  const sobrante = await cargarSobrante(codigo);
  if (!sobrante) notFound();

  const qr = await QRCode.toString(sobrante.codigo, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return <EtiquetaSobrante sobrante={sobrante} qr={qr} />;
}
