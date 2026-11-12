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

## Datos de prueba en Odoo y Supabase

`npm run seed:odoo` llena el **Odoo de pruebas** con productos (planchas, materiales, accesorios y
servicios), tres clientes `SEED …` y sus cotizaciones (`sale.order`), y escribe
`supabase/seeds/cotizaciones.sql` con las cotizaciones de ejemplo que apuntan a esos ids.

- **Productos**: del Excel `supabase/seeds/productos.xlsx`. **Cada hoja es una categoría y cada fila un
  producto**: *Planchas* (material, ancho, largo, espesor, variante, detalle, código, alerta, nota),
  *Accesorios* (material, medida, variante, detalle, código) y *Servicios* (nombre, código). Las
  columnas se reconocen por la cabecera y `-` cuenta como vacío. Sin columna de nombre, se arma con
  las demás; sin columna de precio, se estima (planchas por área × espesor, accesorios por material:
  `PRECIOS_ACCESORIOS` en `scripts/seed-odoo-datos.mjs`). Un código repetido (`ACC001`) da un
  producto por fila; por eso los productos se identifican por código + nombre. Avisa de los códigos
  del catálogo de cortes que falten en el Excel.
- Lee las `ODOO_*` de `.env.local` y **no hace nada sin `ODOO_SEED_OK=1`**: mira la base que imprime
  antes. Se puede repetir; actualiza por `default_code` en vez de duplicar.

```bash
npm run seed:odoo -- --dry-run
```

```bash
ODOO_SEED_OK=1 npm run seed:odoo -- --stock
```

`--stock` pone existencias (necesita el módulo Inventario). Después, Supabase: en local
`npx supabase db reset` carga `seed.sql` y luego `seeds/cotizaciones.sql`; en el proyecto alojado, se
pega `supabase/seeds/cotizaciones.sql` en el SQL Editor (va después de `seed.sql`, usa a Ana). El
archivo del repo salió del Odoo falso: regenéralo contra tu Odoo para que los ids coincidan.

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

Para correrlos contra un Supabase **local** sin tocar el `next dev` que tengas abierto —o desde un
worktree, donde el del puerto 3000 sirve otro código— está `playwright.local.config.ts`: levanta la
app en el 3100 y el Odoo falso en el 8169.

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api> NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local> \
  npx playwright test -c playwright.local.config.ts
```

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
  Desde el detalle, **Crear pedido** abre `/pedidos/nuevo?cotizacion=<id>` con lo cotizado ya
  llenado y pide elegir si va para el **taller o la tienda** (`ubicacion_actual`). `crear_pedido`
  vincula la cotización en la misma transacción (`cotizaciones.pedido_id`, una sola vez) y después
  la `sale.order` se confirma en Odoo; si Odoo falla, el pedido queda igual y la cotización ofrece
  *Confirmar en Odoo*.
- `lib/odoo/` — el cliente de Odoo. `rpc.ts` es la única costura (JSON-RPC clásica, de la 14 a la
  19; para JSON-2 solo cambia ese archivo). `indice.ts` guarda clientes y productos en la memoria
  del servidor y los mantiene al día por `write_date`, para buscar al ritmo del teclado.
- `lib/busqueda-inteligente.ts` — el buscador: el código manda (`AC-003`, `ac 003` y `AC003` son lo
  mismo; un código exacto va primero y un lector de códigos de barras agrega con Enter), cada
  palabra en cualquier orden, sin tildes y con errores de tipeo, y desempata lo más cotizado.
- `lib/cortes/` — el cálculo de un corte ("10 piezas de 60×80 en acrílico de 3 mm"), puro: corre
  igual en el navegador y en el servidor. `optimizador.ts` acomoda las piezas en planchas con
  cortes de guillotina (prueba cuatro órdenes y se queda con el mejor); `cobro.ts` decide qué se
  cobra de cada plancha —el cuarto o la media donde las piezas *realmente* caben, con recargo, o
  la plancha entera— y deja el resto como sobrante; `laser.ts` y `manual.ts` son el servicio;
  `calcular.ts` lo junta y ordena los formatos de plancha por precio.
- **Configuración** (`app/(app)/configuracion/`, solo Administración): los precios de corte (tabla
  del láser, corte manual por espesor, recargo, grosor del corte) y el catálogo de planchas
  (`grupos_plancha` → `formatos_plancha`, cada formato con su código de Odoo). Los parámetros se
  guardan en `configuracion`; un valor que falte o no sirva cae a su defecto
  (`lib/cortes/config.ts`), así que una tabla mal escrita no deja a la tienda sin cotizar. El
  precio de la plancha no se guarda: sale de Odoo por el código.
- **Cortes en la cotización** (`components/cortes/`): junto al buscador de productos, *Corte a
  medida* abre el editor: material, tipo de corte y piezas. El cálculo corre en el navegador a cada
  tecla sobre todos los formatos de ese material (los precios vienen del índice de productos,
  `/api/cortes/precios`), se queda con los tres más baratos y solo por esos pregunta el stock a
  Odoo, una vez (`/api/cortes/stock`); queda elegido el más barato con planchas suficientes. Al
  guardar, el servidor rehace el cálculo (`prepararCorte`) y, si el total ya no coincide con el
  que se mostró, lo rechaza. La línea guarda el cálculo entero en `cotizacion_productos.corte`
  (`lib/cortes/guardado.ts`): es lo que se cotizó, y de ahí sale el plano. A Odoo va como una
  línea de plancha por cada precio distinto ("2 completas", "1 media") más el servicio de corte.
- **Pedidos con productos de Odoo** (`components/nuevo-pedido-form.tsx`): un pedido se arma como
  una cotización —cliente, productos y cortes con los mismos buscadores y el mismo editor— más lo
  suyo (a dónde va, cuándo, cómo se paga). Detrás de cada pedido hay una cotización:
  `registrarPedido` la guarda (`lib/cotizaciones-registro.ts`), la crea en Odoo (de ahí el total
  con impuestos), registra el pedido enlazado y confirma la orden, que es lo que reserva el stock.
  Si Odoo falla, el pedido queda registrado igual y se reintenta desde la cotización. El taller ve
  las líneas sin precios por `lineas_de_pedido()` (migración `20261110000300`), y las planchas
  realmente usadas se anotan con `anotar_planchas_usadas()`.
- **El stock al terminar** (`lib/pedido-odoo-servidor.ts`, `lib/odoo/entregas.ts`): el detalle del
  pedido muestra sus productos y cortes con el plano de cada plancha (`components/lineas-pedido.tsx`).
  Al pasar a **Listo** se pregunta cuántas planchas se usaron en cada corte —llegan las calculadas— y
  se valida la entrega de la venta en Odoo con eso: es lo que baja el stock. Lo que no salió no deja
  entrega pendiente. Al **anular** un pedido que no terminó, la venta se cancela en Odoo y lo
  reservado queda libre; si el stock ya bajó, no se toca (la devolución se hace en Odoo). Si Odoo
  falla, el pedido se mueve igual y el detalle ofrece *Reintentar*. Supone la entrega en un paso
  (la configuración por defecto del almacén). Todo pasa por funciones de la base
  (`odoo_de_pedido()`, `anotar_stock_de_pedido()`, `anotar_anulacion_en_odoo()`, migración
  `20261111000100`) porque quien mueve el pedido puede ser el taller, que no lee `cotizaciones`.
- **La hoja de corte** (`/pedidos/<código>/hoja-de-corte`, `components/hoja-corte.tsx`): se abre desde
  *Productos y cortes* y se imprime en A4. Lleva los datos del pedido y sus indicaciones (sin la lista
  de productos que el detalle repite, `lib/hoja-corte.ts`), y por cada corte la lista de medidas
  numeradas y cada plancha a escala: de dónde sale (plancha nueva o sobrante), qué piezas lleva, el
  primer corte cuando se cobra una fracción y lo que vuelve al almacén. Tiene casillas para ir
  marcando y un hueco para las planchas usadas. No muestra precios a nadie. Al imprimir se esconde el
  menú de la app y el tema oscuro no aplica: `globals.css` solo lo activa en pantalla.
- **Sobrantes** (`/sobrantes`, los tres roles): los pedazos de plancha que vuelven al almacén. En Odoo
  cada uno es un lote del producto *Sobrante* de su material (`SOB-<código de la plancha más chica del
  grupo>`, almacenable y con lotes), con una unidad en stock y su medida en `x_largo` / `x_ancho`. La
  app crea el producto y esos dos campos la primera vez (`lib/odoo/sobrantes.ts`; crear campos pide un
  usuario de Odoo con permiso de administración). La tabla `sobrantes` es su espejo (migración
  `20261112000100`): se busca por material y por la medida que hace falta, se registran a mano los
  que ya están en el almacén, se cambia la ubicación (texto libre, va a la nota del lote) y se imprime
  la etiqueta con QR (`/sobrantes/<código>/etiqueta`, 80 × 50 mm). *Sincronizar con Odoo* reconcilia
  la tabla con el stock de Odoo, que es el que manda (`lib/sobrantes-servidor.ts`). Media o cuarta
  parte de un formato queda marcada como estándar. Con un lado menor que el retazo mínimo de la
  configuración no se registra.
- **La producción con piloto** (`lib/odoo/produccion.ts`, `lib/produccion-servidor.ts`): en un material
  con el piloto encendido (Configuración), un corte se vende como *Corte a medida* de su material
  (`CAM-<código>`, en m² de piezas) por el mismo importe que el cálculo por fracción; lo que el precio
  por m² no cuadra al céntimo lo absorbe la línea del servicio. Al confirmar el pedido nace su orden
  de fabricación, sin lista de materiales: consume las planchas nuevas del cálculo, produce los m² y
  prevé los sobrantes (con su parte del costo por área). Al pasar a **Listo**, el diálogo propone los
  pedazos que vuelven al almacén (las zonas libres que no son retazo); el taller los mide, les pone
  ubicación, quita o agrega. Se guardan en `sobrantes` antes de ir a Odoo, la orden se cierra con lo
  real (un lote por sobrante, con `x_largo` / `x_ancho`) y la entrega saca el corte terminado. Al
  anular, la orden se cancela. Un sobrante nacido de un corte solo entra a Odoo al cerrar su orden:
  *Sincronizar* no lo crea por su cuenta (lo pondría dos veces en el stock). Migración
  `20261112000200`. Necesita en Odoo el módulo Fabricación y la unidad m².
- **El reuso de sobrantes** (piloto): el cálculo de un corte usa primero los sobrantes disponibles del
  material (del color pedido si el código es compartido), del más chico al más grande y los estándar
  al final; el precio no cambia, es el de planchas nuevas. Al registrar el pedido, el acomodo se
  rehace con lo disponible en ese momento y esos sobrantes quedan reservados en la misma transacción
  (`reservar_sobrantes_de_corte()`, migración `20261112000300`; si otro pedido se lleva uno, se rehace
  sin él). La orden de fabricación los consume por lote; al cerrarla quedan consumidos y, si el
  pedido se anula, vuelven a estar disponibles. `pedido_id` dice de qué corte nació un sobrante;
  `reserva_pedido_id`, quién lo tiene reservado o lo consumió.
