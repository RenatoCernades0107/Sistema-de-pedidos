import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { medir } from "./lib/tiempos";

/**
 * Refresca la sesión de Supabase en cada petición y hace el desvío obvio: sin
 * sesión, al login. Es una comprobación optimista, no la autorización — de eso
 * se encarga el layout de `(app)`, que sí lee el perfil y su rol, y sobre todo
 * la RLS de Postgres. Aquí solo se evita renderizar una pantalla que se va a
 * caer igual.
 *
 * En Next 16 este archivo se llama `proxy.ts`; `middleware.ts` quedó deprecado.
 */

const PUBLICAS = ["/login", "/olvide-contrasena"];

/**
 * Lo que ve el cliente, que no tiene cuenta: el PDF de su cotización y el
 * seguimiento de su pedido. El permiso es el token de la URL. A diferencia del
 * login, quien tiene sesión también entra (para revisar el enlace que manda).
 */
const ABIERTAS = ["/c", "/seguimiento"];

/**
 * Los enlaces de los correos de Auth (recuperar contraseña, confirmar el correo).
 * Llegan sin sesión —la crean ellos— y quien ya la tiene también debe poder
 * pasar, así que no son ni públicas como el login ni de las de arriba.
 */
const ENLACES_AUTH = ["/auth"];

/**
 * Los webhooks de servicios externos (Kapso, para WhatsApp). Llegan sin sesión y
 * se autorizan solos, con la firma del servicio: ver su route handler.
 */
const WEBHOOKS = ["/api/whatsapp/webhook"];

export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (nuevas, cabeceras) => {
          // Las cookies van a la petición (para lo que se renderice después) y a
          // la respuesta (para que el navegador se quede con la sesión nueva).
          nuevas.forEach(({ name, value }) => request.cookies.set(name, value));
          respuesta = NextResponse.next({ request });
          nuevas.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options),
          );
          // Sin estas cabeceras, un CDN podría cachear la respuesta que trae la
          // sesión y servírsela a otra persona.
          Object.entries(cabeceras ?? {}).forEach(([clave, valor]) =>
            respuesta.headers.set(clave, valor),
          );
        },
      },
    },
  );

  // `getClaims` verifica el JWT en local (con las claves de firma asimétricas de
  // Supabase) y solo va a la red si el token caducó y hay que refrescarlo.
  // `getUser` era una llamada a Auth en cada petición. Aquí basta: es la
  // comprobación optimista; la autorización la hacen el layout y la RLS.
  const { data: claims } = await medir("proxy.getClaims", () => supabase.auth.getClaims());
  const user = claims?.claims ?? null;

  const ruta = request.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));
  const esAbierta = [...ABIERTAS, ...ENLACES_AUTH, ...WEBHOOKS].some(
    (p) => ruta === p || ruta.startsWith(`${p}/`),
  );

  if (!user && !esPublica && !esAbierta) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Para devolver a la persona a donde iba, en vez de a la vista por defecto.
    if (ruta !== "/") login.searchParams.set("siguiente", ruta);
    return NextResponse.redirect(login);
  }

  if (user && esPublica) {
    const inicio = request.nextUrl.clone();
    inicio.pathname = "/";
    inicio.search = "";
    return NextResponse.redirect(inicio);
  }

  return respuesta;
}

export const config = {
  matcher: [
    /*
     * Todo salvo los estáticos y las imágenes: refrescar la sesión en cada icono
     * es gastar una llamada a Supabase por archivo.
     */
    "/((?!_next/static|_next/image|favicon.ico|icono.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
