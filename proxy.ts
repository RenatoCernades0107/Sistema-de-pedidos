import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refresca la sesión de Supabase en cada petición y hace el desvío obvio: sin
 * sesión, al login. Es una comprobación optimista, no la autorización — de eso
 * se encarga el layout de `(app)`, que sí lee el perfil y su rol, y sobre todo
 * la RLS de Postgres. Aquí solo se evita renderizar una pantalla que se va a
 * caer igual.
 *
 * En Next 16 este archivo se llama `proxy.ts`; `middleware.ts` quedó deprecado.
 */

const PUBLICAS = ["/login"];

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  if (!user && !esPublica) {
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
