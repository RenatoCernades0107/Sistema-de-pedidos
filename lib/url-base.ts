import { headers } from "next/headers";

/**
 * La dirección pública de la app tal como la ve quien hace la petición. Hace falta
 * para decirle a Supabase Auth a dónde volver desde el enlace de un correo.
 *
 * Detrás de un proxy (Vercel, Amplify) el `host` es el interno; manda
 * `x-forwarded-host`. Si el despliegue fija `NEXT_PUBLIC_SITE_URL`, gana ese valor.
 * Supabase solo redirige a las direcciones de su lista de permitidas, así que un
 * `Host` manipulado no lleva a ningún lado que no esté autorizado.
 */
export async function urlBase(): Promise<string> {
  const fija = process.env.NEXT_PUBLIC_SITE_URL;
  if (fija) return fija.replace(/\/+$/, "");

  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo =
    cabeceras.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${protocolo}://${host}`;
}
