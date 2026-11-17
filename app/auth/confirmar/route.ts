/**
 * A donde apuntan los enlaces de los correos de Supabase Auth: recuperar la
 * contraseña y confirmar el correo nuevo. Canjea el enlace por una sesión y manda
 * a la persona a la pantalla que corresponde.
 *
 * Entiende los dos formatos que puede traer el enlace:
 *  - `token_hash` + `type`: el de las plantillas de `supabase/templates`. Se canjea
 *    en el servidor, así que funciona aunque el correo se abra en otro aparato.
 *  - `code`: el flujo PKCE por defecto. Solo sirve en el mismo navegador donde se
 *    pidió, y queda de respaldo por si la plantilla del proyecto no se cambió.
 *
 * Está en `ENLACES_AUTH` del proxy: llega sin sesión.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { clienteServidor } from "@/lib/supabase-servidor";

/** Solo estos dos: cualquier otro tipo (signup, magiclink…) no es de este sistema. */
const DESTINOS = {
  recovery: "/restablecer-contrasena",
  email_change: "/cuenta/correo?confirmado=1",
} as const;

type Tipo = keyof typeof DESTINOS;

const esTipo = (valor: string | null): valor is Tipo =>
  valor !== null && Object.hasOwn(DESTINOS, valor);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const codigo = searchParams.get("code");
  const tipo = searchParams.get("type");

  const supabase = await clienteServidor();
  let destino: string | null = null;

  if (tokenHash && esTipo(tipo)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tipo as EmailOtpType,
    });
    if (!error) destino = DESTINOS[tipo];
  } else if (codigo) {
    const { error } = await supabase.auth.exchangeCodeForSession(codigo);
    // El flujo PKCE no dice de qué era el enlace; la sesión recién creada solo
    // sirve para elegir contraseña nueva o ya con el correo confirmado.
    if (!error) destino = esTipo(tipo) ? DESTINOS[tipo] : DESTINOS.recovery;
  }

  const url = request.nextUrl.clone();
  url.search = "";

  if (!destino) {
    url.pathname = "/olvide-contrasena";
    url.searchParams.set("error", "enlace");
    return NextResponse.redirect(url);
  }

  const [ruta, consulta] = destino.split("?");
  url.pathname = ruta;
  if (consulta) url.search = `?${consulta}`;
  return NextResponse.redirect(url);
}
