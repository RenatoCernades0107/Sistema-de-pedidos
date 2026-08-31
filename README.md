# Pedidos Plexiacril — la app

Next.js 16 (App Router) sobre Supabase. El modelo de datos y los roles están en el
[`README.md` de la raíz](../README.md); el porqué de cada decisión, en [`plan.md`](../plan.md).
Esto es lo que hace falta para levantarla, probarla y desplegarla.

## Levantarla

```bash
npm install
npm run dev            # http://localhost:3000
```

Hace falta un `.env.local` con las dos variables de [`.env.example`](.env.example). Las dos son
públicas a propósito: la clave publicable viaja al navegador y lo que protege los datos es la RLS,
no esconderla.

Usuarios de desarrollo (contraseña `plexi2026` en los tres): `ana` (administración), `carla`
(logística), `miguel` (operaciones). **Se entra con el usuario, no con el correo**: el correo es el
identificador interno de Supabase Auth y `email_de_usuario()` traduce uno en otro antes de
autenticar.

**La primera vez que entra una cuenta, la app la manda a `/cambiar-contrasena` y no la deja pasar de
ahí.** La marca (`usuarios.debe_cambiar_password`) se pone sola al crear la cuenta y solo la baja su
dueño, después de cambiarla; la migración que la introdujo marcó también a las tres de arriba. Los
tests la bajan al empezar y la vuelven a dejar como estaba al terminar (`e2e/preparar.ts`); para
trabajar en local sin pasar por esa pantalla, se baja a mano desde el panel de Supabase.

## Probarla

```bash
npm run lint
npm run build
npm run e2e            # Playwright; levanta `next dev` solo si no lo encuentra
```

Los tests de punta a punta corren **contra la base real**, que es la única que hay. Cada prueba crea
sus propias filas con el cliente prefijado `E2E` y las borra al terminar; ninguna toca los 23 pedidos
del seed. Las pruebas del esquema son SQL y van aparte: `supabase/tests/README.md`.

## Desplegarla en Vercel

1. Importar el repositorio en Vercel con **Root Directory = `web/`**. El resto lo detecta solo
   (Next.js, `npm run build`, salida en `.next`).
2. Cargar las dos variables de `.env.example` en *Settings → Environment Variables*, en los tres
   entornos (Production, Preview y Development). No hay secretos del servidor que añadir.
3. En Supabase, *Authentication → URL Configuration*: poner el dominio de Vercel como **Site URL** y
   añadirlo a **Redirect URLs**. Sin esto la sesión se crea y se pierde al primer refresco.
4. Desplegar y entrar una vez con cada rol. Lo que conviene mirar: que `/` reparta a cada uno a su
   vista, que la lista traiga pedidos (si no, es la RLS o las variables) y que un cambio de estado
   sobreviva a una recarga.

Para correr los tests contra el despliegue en vez de contra `localhost`:

```bash
E2E_URL=https://<dominio>.vercel.app npm run e2e
```

## Cómo está armado

- `app/(app)/` — las vistas por rol. El layout carga los pedidos una vez y las cuatro páginas
  filtran sobre el mismo conjunto; `acciones.ts` son las Server Actions, el único camino de
  escritura en la base. `adjuntos-acciones.ts` es el de los archivos: el binario sube del navegador
  a Storage —el cuerpo de una Server Action está limitado a 1 MB y la RLS del bucket ya decide quién
  escribe—, y por la acción pasa solo la fila que lo registra.
- `app/login/`, `app/cambiar-contrasena/`, `proxy.ts` — sesión. En Next 16 `middleware.ts` está
  deprecado: el refresco de la sesión y el desvío al login viven en `proxy.ts`. Quién puede pasar de
  ahí lo decide `exigirSesion()` en `lib/sesion.ts`, que es también la que obliga al cambio de
  contraseña inicial.
- `lib/dominio.ts` — el contrato de tipos y los permisos por rol que usa la UI. La seguridad de
  verdad está en Postgres; esto solo decide qué se pinta.
- `lib/pedidos-servidor.ts` — lee la vista que le toca al rol (`pedidos_admin` / `_logistica` /
  `_operaciones`) y arma el `Pedido` que espera la UI.
- `lib/esquemas.ts` — los Zod que comparten formulario y Server Action.
- `lib/adjuntos.ts` — tipos admitidos, tope de 10 MB y la ruta dentro del bucket. Las corren el
  navegador y el servidor; quien corta de verdad es el propio bucket
  (`20260901000500_adjuntos_limites.sql`).
- `components/ui/` — primitivas sobre Base UI. `campo.tsx` es el que enlaza etiqueta, control, ayuda
  y error; todo campo de formulario pasa por ahí.
- `supabase/migrations/` — la fuente de verdad del modelo.
