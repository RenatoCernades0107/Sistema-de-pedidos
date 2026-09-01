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
  `numero_factura` a `numero_comprobante` y la aceptación de boletas): los dos CHECK
  con nombre, el reparto por rol de las vistas, el trigger de auditoría y el formato
  probado en caliente. **No necesita las cuentas del seed**, así que es la que sirve
  en un proyecto con usuarios reales. También termina en `ROLLBACK`.
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
propias filas: nunca toca los 23 pedidos del seed.

**Al escribir una prueba nueva:** `click()` vuelve en cuanto suelta el evento, no cuando
la Server Action termina. Recargar justo después aborta el POST a media respuesta y la
prueba acaba mirando una página que no refleja lo que acaba de guardar. Para eso está
`alGuardar()` en `e2e/apoyo.ts`; toda escritura pasa por ahí.
