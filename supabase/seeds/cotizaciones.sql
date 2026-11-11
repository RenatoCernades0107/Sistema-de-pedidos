-- Cotizaciones de ejemplo. GENERADO por scripts/seed-odoo.mjs a partir de lo que
-- devolvió el Odoo de pruebas (ids de clientes, productos y sale.order). No se
-- edita a mano: se vuelve a generar sembrando Odoo.
--
-- Va después de seed.sql (usa a Ana como autora). Se puede correr varias veces:
-- cada cotización se salta si ya existe una con su misma nota de origen.

with c as (
  insert into public.cotizaciones (
    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,
    creado_por, creado_en
  )
  select 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    1, 'S00001', 'sincronizada', null,
    387, 69.66, 456.66, '[SEED-COT-1] Letrero recepción', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '6 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-1]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', 'Corte a 60x40 cm', 2, 147),
  (2, 283, 'SEPARADOR DE ACERO 25X25MM', 'ACC-SEP-25', null, 8, 6),
  (3, 31, 'SERVICIO DE CORTE LASER', 'SRV002', null, 45, 1)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);

with c as (
  insert into public.cotizaciones (
    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,
    creado_por, creado_en
  )
  select 6, 'SEED María Torres Huamán', '41234567', '988 112 233',
    2, 'S00002', 'sincronizada', null,
    144, 25.92, 169.92, '[SEED-COT-2]', true,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '5 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-2]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 10, 'ACRILICO F8 CRISTAL 3MM', 'AC-003', 'Repisa 80x25 cm, cantos pulidos', 1, 120),
  (2, 298, 'SERVICIO DE PULIDO DE CANTOS (METRO)', 'SRV005', null, 2, 6),
  (3, 290, 'PEGAMENTO PARA ACRILICO JERINGA 30ML', 'ACC-PEG-02', null, 1, 12)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);

with c as (
  insert into public.cotizaciones (
    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,
    creado_por, creado_en
  )
  select 7, 'SEED Constructora Sur EIRL', '20456789013', '054 22 3344',
    3, 'S00003', 'sincronizada', null,
    1418, 255.24, 1673.24, '[SEED-COT-3] Mamparas oficina', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '4 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-3]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 281, 'POLICARBONATO COMPACTO CRISTAL 4MM', 'PC-004', null, 3, 420),
  (2, 287, 'BISAGRA PARA ACRILICO CROMADA', 'ACC-BIS-01', null, 6, 9.5),
  (3, 288, 'JALADOR ACRILICO CRISTAL 10CM', 'ACC-JAL-01', null, 3, 7),
  (4, 299, 'SERVICIO DE INSTALACION', 'SRV006', null, 1, 80)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);

with c as (
  insert into public.cotizaciones (
    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,
    creado_por, creado_en
  )
  select 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    null, null, 'pendiente', null,
    223, 40.14, 263.14, '[SEED-COT-4] Caja de luz', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '2 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-4]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 277, 'PVC ESPUMADO BLANCO 5MM', 'PVC-005', null, 2, 65),
  (2, 292, 'CINTA LED 12V BLANCO FRIO (METRO)', 'ACC-LED-01', null, 6, 8),
  (3, 293, 'FUENTE 12V 5A', 'ACC-LED-02', null, 1, 35),
  (4, 30, 'SERVICIO DE CORTE MANUAL', 'SRV001', null, 10, 1)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);

with c as (
  insert into public.cotizaciones (
    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,
    creado_por, creado_en
  )
  select 6, 'SEED María Torres Huamán', '41234567', '988 112 233',
    null, null, 'error', 'Odoo no respondió (dato de prueba).',
    155, 27.9, 182.9, '[SEED-COT-5]', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '1 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-5]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 12, 'ACRILICO BRONCE 3MM', 'AC-103', 'Espejo decorativo 50x50', 1, 135),
  (2, 296, 'SERVICIO DE GRABADO LASER', 'SRV003', null, 20, 1)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);

with c as (
  insert into public.cotizaciones (
    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,
    creado_por, creado_en
  )
  select 7, 'SEED Constructora Sur EIRL', '20456789013', '054 22 3344',
    4, 'S00004', 'sincronizada', null,
    567, 102.06, 669.06, '[SEED-COT-6] Señalética', true,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '0 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-6]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 11, 'ACRILICO F8 CRISTAL 5MM', 'AC-005', null, 2, 190),
  (2, 291, 'CINTA DOBLE CONTACTO VHB 19MM X 33M', 'ACC-CIN-01', null, 1, 55),
  (3, 294, 'SOPORTE PORTA AFICHE ALUMINIO', 'ACC-SOP-01', null, 4, 18),
  (4, 31, 'SERVICIO DE CORTE LASER', 'SRV002', null, 60, 1)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);
