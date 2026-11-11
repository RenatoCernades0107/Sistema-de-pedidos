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
  (2, 291, 'SOPORTES DE ACRILICO 25MM X 40MM CRISTAL', 'ACC032', null, 8, 6),
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
    787, 141.66, 928.66, '[SEED-COT-2] Repisa de superficie sólida', true,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '5 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-2]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 257, 'SUPERFICIE SOLIDA DE ACRILICO WHITE (KS-003) 12MM 0.76X3.68', 'SS001', 'Repisa 80x25 cm', 1, 738),
  (2, 322, 'ADHESIVO 50 ML WHITE SUPERFICIE SOLIDA (KS-003)', 'PEG003', null, 1, 45),
  (3, 30, 'SERVICIO DE CORTE MANUAL', 'SRV001', null, 4, 1)
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
    590, 106.2, 696.2, '[SEED-COT-3] Vitrinas', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '4 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-3]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 24, 'ACRILICO ECO COLORES NEGRO 3MM 1.22X1.83', 'F7E029', null, 3, 147),
  (2, 271, 'BISAGRAS 25MM X 33MM CRISTAL', 'ACC003', null, 6, 8),
  (3, 301, 'MANIJAS DE ACRILICO (JALADOR) 20MM CRISTAL TIPO CORONA', 'ACC038', null, 3, 7),
  (4, 329, 'SERVICIO DE INSTALACION', 'SRV004', null, 1, 80)
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
    248, 44.64, 292.64, '[SEED-COT-4] Exhibidor giratorio', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '2 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-4]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', null, 1, 147),
  (2, 295, 'SISTEMA GIRATORIO 100MM CRISTAL', 'ACC035', null, 1, 35),
  (3, 277, 'TORNILLOS 6MM CRISTAL', 'ACC001', null, 12, 3),
  (4, 31, 'SERVICIO DE CORTE LASER', 'SRV002', null, 30, 1)
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
    438, 78.84, 516.84, '[SEED-COT-5]', false,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '1 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-5]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 269, 'SUPERFICIE SOLIDA DE ACRILICO WHITE (KS-003) 6MM 1.22X2.44', 'SS002', 'Mesa 120x60', 1, 393),
  (2, 327, 'ADHESIVO 250 ML WHITE SUPERFICIE SOLIDA (KS-003)', 'PEG002', null, 1, 45)
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
    428, 77.04, 505.04, '[SEED-COT-6] Señalética', true,
    (select id from public.usuarios where email = 'ana@plexiacril.test'),
    now() - interval '0 days'
  where not exists (select 1 from public.cotizaciones where notas like '[SEED-COT-6]%')
  returning id
)
insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)
select c.id, l.* from c, (values
  (1, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', null, 2, 147),
  (2, 292, 'SOPORTES DE ACRILICO 19MM X 30MM CRISTAL', 'ACC033', null, 4, 6),
  (3, 282, 'BARRAS DE ACRILICO 6MM X 1200MM CRISTAL', 'ACC017', null, 2, 25),
  (4, 31, 'SERVICIO DE CORTE LASER', 'SRV002', null, 60, 1)
) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);
