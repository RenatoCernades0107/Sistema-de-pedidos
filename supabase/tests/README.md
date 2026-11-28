# Pruebas del esquema

Dos scripts, los dos pensados para correr contra el proyecto de Supabase en la nube:

- **`asserts.sql`** — verifica las reglas del esquema (código, inmutabilidad, CHECKs,
  máquina de estados, saldos, auditoría y permisos por rol). Crea pedidos de prueba
  dentro de una transacción que termina en `ROLLBACK`, así que no deja nada en la base.
  Si algo no cumple, aborta con un `RAISE EXCEPTION` explicando qué falló.
  Desde la Fase 4 cubre también las escrituras que hace la app: el alta completa por
  `crear_pedido`, el sobrepago, `INSERT ... RETURNING` sobre columnas revocadas, las
  vistas de rol como solo lectura, y quién puede crear, facturar y entregar.
- **`comprobante.sql`** — verifica solo la migración `20260901000800` (el paso de
  `numero_factura` a `numero_comprobante` y la aceptación de boletas, menos el CHECK
  de entrega que quitó `20261001000100`): el CHECK de formato
  con nombre, el reparto por rol de las vistas, el trigger de auditoría y el formato
  probado en caliente. **No necesita las cuentas del seed**, así que es la que sirve
  en un proyecto con usuarios reales. También termina en `ROLLBACK`.
- **`terminados.sql`** — verifica las migraciones `20261113000100`–`400`: el catálogo de
  productos terminados y su RLS, la línea de tipo `terminado` con su ficha, que quien
  no es Administración la ve sin precios, y el anotado de los materiales usados.
  Tampoco necesita las cuentas del seed, y termina en `ROLLBACK`.
- **`terminados_cad.sql`** — verifica la migración `20261119000100`: `plantilla_cad` y
  `parametros_cad` de `pt_productos` (van juntos, en mm), los valores de algunos productos
  y que los que ninguna plantilla cubre quedan en null. Termina en `ROLLBACK`.
- **`cad.sql`** — verifica la migración `20261116000100` (y la columna `referencias` de `20261123000100`): las tablas de los diseños CAD
  y su RLS, la numeración de versiones de `guardar_version_diseno`, los CHECK de origen
  y rol, la cascada al borrar un diseño y que desde `20261129000300` los otros roles
  también ven y editan (pero no borran el diseño de otra persona ni aprueban un
  diseño libre). Tampoco necesita las cuentas del seed, y termina en `ROLLBACK`.
- **`cad_contornos.sql`** — verifica la migración `20261225000100`: los contornos vectoriales (logos)
  de los diseños libres. Solo inserción, nombre único por diseño, checks de nombre, medidas y
  trazos, `creado_por` firmado por la sesión y cascada al borrar el diseño. Termina en `ROLLBACK`.
- **`cad_versiones.sql`** — verifica la migración `20261129000300`: restaurar una versión
  (numera, copia, `origen`/`restaurada_de`, la aprobación de un libre solo con el mismo
  código), el nombre de una versión, el autor firmado por la sesión y el aviso
  `diseno_modificado` (a otro autor sí, a uno mismo no, uno cada 30 minutos salvo que
  la persona vuelva a guardar). Crea sus propias personas de prueba; termina en `ROLLBACK`.
- **`signup_publico.sql`** — verifica la migración `20261209000100`: el rol del perfil solo se toma
  de `app_metadata`; un alta con el rol en `user_metadata` (lo que controla quien se registra) nace
  desactivada y sin rol efectivo. Termina en `ROLLBACK`.
- **`intentos_login.sql`** — verifica la migración `20261209000200`: el bloqueo del login a los 5
  fallos por usuario o 20 por IP en 15 minutos, que se levanta pasada la ventana o con un ingreso
  correcto, y que sin la clave del servidor las funciones no hacen nada. Necesita la seed (usa el
  secreto `login` de desarrollo) y termina en `ROLLBACK`.
- **`correo_recuperacion.sql`** — verifica las migraciones `20261201000100` y `20261202000100`: el
  trigger que copia el correo de Auth al perfil, que `email_de_usuario` y
  `tiene_correo_recuperacion` no respondan sin la clave del servidor, el CHECK de formato y que
  `secretos_app` y `cerrar_sesiones_de` no sean accesibles a `anon`/`authenticated`. Necesita la
  seed (usa a `ana` y el secreto de desarrollo) y termina en `ROLLBACK`.
- **`lineas_de_pedidos.sql`** — verifica la migración `20261203000100`: `lineas_de_pedidos(ids)`
  trae las mismas líneas que `lineas_de_pedido(codigo)` pedido por pedido, cada una con su pedido;
  Administración las ve con precios, el taller sin ellos, y una sesión sin perfil no ve nada.
  Necesita el seed (entra como `ana` y `miguel`) y termina en `ROLLBACK`.
- **`almacenes.sql`** — verifica las migraciones `20261205000100`–`200`: los tres almacenes con su
  papel (un solo taller y una sola tienda), que ya no hay código compartido entre colores y todos los
  materiales registran sobrantes, los accesorios sembrados en sus categorías, que un sobrante necesita
  su almacén, y por rol: el taller ve los almacenes pero no crea almacenes, ingresos ni accesorios, ni
  toca el precio de un sobrante; Logística gestiona el stock (ingresos, accesorios, planchas nuevas)
  sin cambiar el catálogo ni los precios; Administración fija y devuelve al calculado el precio de un
  sobrante. Entra como el primer usuario activo de cada rol, así que no necesita las cuentas del seed.
  Termina en `ROLLBACK`.
- **`versiones_cotizacion.sql`** — verifica la migración `20261215000100`: una cotización nace borrador y
  se edita (cliente y líneas, conservando un corte), queda marcada si Odoo no tiene lo último y así no
  se envía; enviada, la base rechaza cualquier cambio a lo cotizado y el paso atrás a borrador; la
  versión nueva copia las líneas sin heredar la orden de Odoo, es una sola a la vez y solo de una
  enviada; enviar la v2 deja la v1 como reemplazada. Entra como el primer usuario activo de
  Administración y termina en `ROLLBACK`.
- **`transferencias.sql`** — verifica la migración `20261205000300`: RLS en las tablas nuevas; que
  Logística envía (el sobrante queda en tránsito y no sale dos veces), no transfiere a sí mismo y
  anula solo lo que no salió en Odoo; que el taller recibe (el sobrante queda disponible en su
  almacén nuevo) pero no crea ni anula transferencias ni escribe faltantes; un solo faltante abierto
  por pedido, producto y almacén; y que `avisar_faltantes()` avisa a todo Administración y Logística
  diciendo qué falta. Termina en `ROLLBACK`.
- **`casos.sql`** — verifica la migración `20261205000400`: RLS en las tablas nuevas y que el estado
  de un caso no se cambia sin `cerrar_caso`; que Logística reporta (una baja es negativa, no nace
  cerrada, un sobrante no tiene dos casos abiertos) y cuenta (un conteo enviado no se toca ni se
  envía dos veces) pero no cierra; que el taller no ve casos ni conteos; que Administración cierra
  solo con razón y una sola vez, y que el sobrante dado de baja sale del almacén; y que
  `avisar_casos()` avisa a toda Administración. Termina en `ROLLBACK`.
- **`estado.sql`** — no verifica nada, solo reporta: cuántos pedidos, pagos y adjuntos
  hay, cómo se reparten los estados y si algún saldo quedó descuadrado.

> `asserts.sql` solo corre contra una base **sembrada**: entra como `ana`, `carla` y
> `miguel` para probar los permisos por rol. En el proyecto de producción esas cuentas
> no existen —las reales las crea `usuarios_iniciales.sql`— y aborta en la primera
> comprobación. Ahí usa `comprobante.sql`.

## Cómo correrlos

Lo más corto, y sin instalar nada, es el propio CLI:

```bash
cd web && npx supabase db query --linked -f supabase/tests/asserts.sql
```

Ejecuta el archivo entero en una sola tanda y aborta con el mensaje del `RAISE` si algo
falla. Al terminar sin error devuelve la última fila del script, que es la única señal
de que llegó hasta el final: el `ROLLBACK` no imprime nada.

Con `psql` instalado sale igual:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/asserts.sql
```

También se puede usar el CLI apuntándole el seed al script: en
`supabase/config.toml`, cambiar

```toml
sql_paths = ["./seed.sql"]
```

por el script que se quiera ejecutar, correr `supabase db push --linked --include-seed`
y **volver a dejar `./seed.sql`** al terminar.

Ojo: el CLI recuerda qué archivos ya sembró y se salta los que no cambiaron de nombre.
Para forzar una segunda corrida hay que renombrar el archivo.

## Requisitos

`asserts.sql` necesita los tres usuarios de `seed.sql` (uno por rol) para poder probar
los permisos. Sin ellos falla en la primera comprobación.

## Pruebas de la app

Aparte de estas, `web/e2e/` tiene la suite de Playwright que recorre la app con los
tres roles. La primera vez hace falta bajar el navegador:

```bash
cd web && npx playwright install chromium && npm run e2e
```

Levanta `next dev` sola y corre contra la base real, pero cada prueba crea y borra sus
propias filas: nunca toca los pedidos del seed.

**Al escribir una prueba nueva:** `click()` vuelve en cuanto suelta el evento, no cuando
la Server Action termina. Recargar justo después aborta el POST a media respuesta y la
prueba acaba mirando una página que no refleja lo que acaba de guardar. Para eso está
`alGuardar()` en `e2e/apoyo.ts`; toda escritura pasa por ahí.
