/**
 * El PDF de una cotización, por su enlace público: es lo que se le manda al
 * cliente por WhatsApp o Gmail. No pide sesión (está en `PUBLICAS` del proxy);
 * el permiso es el token.
 *
 * Lo usa también la app para "Descargar PDF", con `?descargar`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { cotizacionPorToken } from "@/lib/compartir-servidor";
import { generarPdfCotizacion } from "@/lib/pdf-cotizacion";
import { nombreArchivoCotizacion } from "@/lib/compartir";

let logo: Promise<Uint8Array | null> | null = null;
/** El logo se lee del disco una vez por proceso. Si falta, el PDF sale sin él. */
const leerLogo = () =>
  (logo ??= readFile(path.join(process.cwd(), "public", "logo-plexiacril.png"))
    .then((b) => new Uint8Array(b))
    .catch(() => null));

export async function GET(request: NextRequest, ctx: RouteContext<"/c/[token]/pdf">) {
  const { token } = await ctx.params;

  const leida = await cotizacionPorToken(token).catch((e) => {
    console.error("[cotizacion publica]", e);
    return undefined;
  });
  if (leida === undefined) return new Response("No se pudo generar la cotización.", { status: 500 });
  if (!leida) return new Response("Este enlace no corresponde a ninguna cotización.", { status: 404 });

  const { cotizacion, validezDias, cuentas } = leida;
  const pdf = await generarPdfCotizacion(cotizacion, await leerLogo(), { validezDias, cuentas });
  const nombre = nombreArchivoCotizacion(cotizacion, "pdf");
  const disposicion = request.nextUrl.searchParams.has("descargar") ? "attachment" : "inline";

  return new Response(pdf as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `${disposicion}; filename="${nombre}"`,
      // Datos de un cliente: que no queden en ninguna caché de paso.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
