# Pedidos Plexiacril — la app

Next.js 16 (App Router) sobre Supabase. El modelo de datos y los roles están en el
[`README.md` de la raíz](../README.md); el porqué de cada decisión, en [`plan.md`](../plan.md).
Esto es lo que hace falta para levantarla, probarla y desplegarla.

## Levantarla

```bash
npm install
npm run dev            # http://localhost:3000
```

Hace falta un `.env.local` con las variables de [`.env.example`](.env.example). Las dos de Supabase
son públicas a propósito: la clave publicable viaja al navegador y lo que protege los datos es la
RLS, no esconderla. Las de Odoo (`ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`) sí son
secretos de servidor: sin ellas la app funciona, pero `/cotizaciones` avisa de que falta conectar
Odoo y no deja buscar ni crear.

Para trabajar contra un Supabase local (necesita Docker) con la seed de prueba:

```bash
npx supabase start     # API en http://127.0.0.1:56321, Studio en http://127.0.0.1:56323
npx supabase db reset  # aplica las migraciones y carga supabase/seed.sql
```

Los puertos son la serie 563xx (no la 543xx por defecto) para convivir con otros proyectos de
Supabase en la misma máquina. En `.env.local`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321` y
la clave publicable que imprime `supabase start`.

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
npm test               # Vitest: búsqueda, líneas, esquemas y el cliente de Odoo contra un Odoo falso
npm run build
npm run e2e            # Playwright; levanta `next dev` solo si no lo encuentra
```

`npm test` no necesita red ni base: lo de Odoo corre contra `e2e/odoo-falso.mts`, un Odoo de mentira
en memoria que habla la misma JSON-RPC. Playwright levanta ese mismo Odoo falso en el puerto 8069 y
arranca `next dev` apuntando a él, así que **ninguna prueba crea clientes ni cotizaciones en el Odoo
de la empresa**. Si ya tienes un `next dev` abierto con el Odoo real, Playwright lo reutiliza: por
eso `e2e/cotizaciones.spec.ts` comprueba primero que la app habla con el falso y, si no, se detiene
sin crear nada. Ciérralo y vuelve a correr. Con `E2E_URL` (contra un despliegue) esas pruebas se
saltan.

Los tests de punta a punta corren **contra la base real**, que es la única que hay. Cada prueba crea
sus propias filas con el cliente prefijado `E2E` y las borra al terminar; ninguna toca los 23 pedidos
del seed. Las pruebas del esquema son SQL y van aparte: `supabase/tests/README.md`.

## Desplegarla en Vercel

1. Importar el repositorio en Vercel con **Root Directory = `web/`**. El resto lo detecta solo
   (Next.js, `npm run build`, salida en `.next`).
2. Cargar las variables de `.env.example` en *Settings → Environment Variables*, en los tres
   entornos (Production, Preview y Development). Las de Odoo y la del agente son secretos: van
   sin `NEXT_PUBLIC_`. `ODOO_PASSWORD` acepta la contraseña del usuario de Odoo o, mejor, una API
   key suya (*Preferencias → Seguridad de la cuenta → Nueva clave API*). Ese usuario tiene que
   poder crear cotizaciones y contactos.
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
- `supabase/migrations/` — la fuente de verdad del modelo. Una migración nueva se aplica con
  `npx supabase db push` y se verifica con su archivo de `supabase/tests/`.
- **Cotizaciones** (`app/(app)/cotizaciones/`): la lista, `nueva` y el detalle; el chat del
  asistente vive en `asistente/`. Cliente y productos son de Odoo: la tabla `cotizaciones` guarda la
  relación (N:1 con el cliente, N:N con los productos vía `cotizacion_productos`, 1:1 con la
  `sale.order`) y una foto de los nombres. Cada alta se guarda primero en Supabase y después se crea
  en Odoo; si Odoo falla, queda en `error` con el motivo y el detalle ofrece reintentar, que no
  duplica (la orden lleva la marca de la fila en *Documento origen*). Lo que crea el asistente se
  registra solo, después de responder al chat.
- `lib/odoo/` — el cliente de Odoo. `rpc.ts` es la única costura (JSON-RPC clásica, de la 14 a la
  19; para JSON-2 solo cambia ese archivo). `indice.ts` guarda clientes y productos en la memoria
  del servidor y los mantiene al día por `write_date`, para buscar al ritmo del teclado.
- `lib/busqueda-inteligente.ts` — el buscador: el código manda (`AC-003`, `ac 003` y `AC003` son lo
  mismo; un código exacto va primero y un lector de códigos de barras agrega con Enter), cada
  palabra en cualquier orden, sin tildes y con errores de tipeo, y desempata lo más cotizado.
