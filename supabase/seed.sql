-- Seed de desarrollo de Plexiacril. Escrito a mano: se edita aquí.
--
-- Trae los tres usuarios de prueba, uno por rol, y 13 pedidos con el modelo actual:
-- cada pedido nace de una cotización (`cotizaciones.pedido_id`) y sus líneas
-- —productos de Odoo, cortes y productos terminados— viven en
-- `cotizacion_productos`. El código (P2611-001) lo pone el trigger del INSERT.
--
-- Las fechas son relativas a hoy (`current_date`): siempre hay pedidos vencidos,
-- de hoy y próximos, y cubren los siete estados, provincia, domicilio, crédito,
-- abonos, observados y anulados.
--
-- Los productos y clientes son los del Odoo de pruebas (`npm run seed:odoo`, ver
-- seeds/cotizaciones.sql). Las órdenes de venta (S09001…) son de mentira: el
-- stock de los pedidos ya listos figura como descontado para que nadie intente
-- moverlo en Odoo.
--
-- Contraseña de los tres: plexi2026. Es un entorno de desarrollo; antes de que
-- entren datos reales hay que cambiarlas.

-- pgcrypto vive en el esquema extensions en Supabase, que no está en el search_path
-- de la sesión que ejecuta el seed: hay que habilitarlo y llamarlo con nombre completo.
create extension if not exists pgcrypto with schema extensions;

-- La carga no es la edición de nadie: sin esto, la auditoría arranca con cientos
-- de filas de ruido y el historial pierde las fechas que trae el seed.
alter table public.pedidos          disable trigger pedidos_auditoria;
alter table public.pedidos          disable trigger pedidos_historial;
alter table public.envios_provincia disable trigger envios_provincia_auditoria;
alter table public.adjuntos         disable trigger adjuntos_auditoria;

-- ── Usuarios ────────────────────────────────────────────────────────────────

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- GoTrue lee estas columnas como texto, no como texto nullable: con NULL, el
  -- inicio de sesión falla con un error de base de datos que no explica nada.
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'ana@plexiacril.test', extensions.crypt('plexi2026', extensions.gen_salt('bf')), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'rol', 'administracion'),
  jsonb_build_object('nombre', 'Ana Torres', 'usuario', 'ana'),
  now(), now(),
  '', '', '', '', '', '', '', ''
-- El índice único de auth.users sobre email es parcial, así que ON CONFLICT no
-- sirve aquí: hay que preguntar a mano si la cuenta ya existe.
where not exists (select 1 from auth.users where email = 'ana@plexiacril.test');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- GoTrue lee estas columnas como texto, no como texto nullable: con NULL, el
  -- inicio de sesión falla con un error de base de datos que no explica nada.
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'carla@plexiacril.test', extensions.crypt('plexi2026', extensions.gen_salt('bf')), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'rol', 'logistica'),
  jsonb_build_object('nombre', 'Carla Díaz', 'usuario', 'carla'),
  now(), now(),
  '', '', '', '', '', '', '', ''
-- El índice único de auth.users sobre email es parcial, así que ON CONFLICT no
-- sirve aquí: hay que preguntar a mano si la cuenta ya existe.
where not exists (select 1 from auth.users where email = 'carla@plexiacril.test');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- GoTrue lee estas columnas como texto, no como texto nullable: con NULL, el
  -- inicio de sesión falla con un error de base de datos que no explica nada.
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'miguel@plexiacril.test', extensions.crypt('plexi2026', extensions.gen_salt('bf')), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'rol', 'operaciones'),
  jsonb_build_object('nombre', 'Miguel Ruiz', 'usuario', 'miguel'),
  now(), now(),
  '', '', '', '', '', '', '', ''
-- El índice único de auth.users sobre email es parcial, así que ON CONFLICT no
-- sirve aquí: hay que preguntar a mano si la cuenta ya existe.
where not exists (select 1 from auth.users where email = 'miguel@plexiacril.test');

-- Sin fila en auth.identities, GoTrue no encuentra la cuenta al iniciar sesión
-- con email y contraseña, aunque el usuario exista.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
-- Para el proveedor `email`, el panel guarda el uuid del usuario como provider_id.
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', u.id::text, now(), now(), now()
from auth.users u
where u.email like '%@plexiacril.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- ── Pedidos ─────────────────────────────────────────────────────────────────
-- Cada pedido se anota aquí con su clave para colgarle después lo demás.
create temporary table seed_pedidos (clave text primary key, id uuid not null, codigo text not null);

-- entregado-tienda: entregado, SEED Publicidad Lima SAC
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED Publicidad Lima SAC', '01 444 5566', array['CL', 'SP']::public.tipo_pedido[], null, 60,
    'contado', null, 643.1, 'tienda', null, 'tienda',
    'entregado', null, (current_date + -6), ((current_date + -12) + time '09:15') at time zone 'America/Lima',
    (current_date + -6), null,
    'Corte láser · Acrílico ECO · Cristal · 3 mm: 12 piezas (12 × 60×40 cm) — 2 planchas de 122×183
  ↳ Grabar el logo al centro de cada placa.
48 × [ACC032] SOPORTES DE ACRILICO 25MM X 40MM CRISTAL', null, null, 'F001-000231', (select id from public.trabajadores where nombre = 'Angel'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'entregado-tienda', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'entregado-tienda'), 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    9001, 'S09001', 'sincronizada', 545, 98.1, 643.1,
    true, true, (select id from public.usuarios where usuario = 'ana'), ((current_date + -12) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', 'Corte láser · Acrílico ECO · Cristal · 3 mm: 12 × 60×40 cm',
   2::numeric, 117.6::numeric, 257::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Cristal","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":60,"alto":40,"cantidad":12}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E024","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":96.7,"piezas":9,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":40,"y2":60,"libre":false,"piezaId":"f1#1","rotada":true},{"x1":40,"y1":0,"x2":80,"y2":60,"libre":false,"piezaId":"f1#2","rotada":true},{"x1":80,"y1":0,"x2":120,"y2":60,"libre":false,"piezaId":"f1#3","rotada":true},{"x1":120,"y1":0,"x2":122,"y2":60,"libre":true},{"x1":0,"y1":60,"x2":40,"y2":120,"libre":false,"piezaId":"f1#4","rotada":true},{"x1":40,"y1":60,"x2":80,"y2":120,"libre":false,"piezaId":"f1#6","rotada":true},{"x1":80,"y1":60,"x2":120,"y2":120,"libre":false,"piezaId":"f1#7","rotada":true},{"x1":120,"y1":60,"x2":122,"y2":120,"libre":true},{"x1":40,"y1":120,"x2":80,"y2":180,"libre":false,"piezaId":"f1#8","rotada":true},{"x1":80,"y1":120,"x2":120,"y2":180,"libre":false,"piezaId":"f1#9","rotada":true},{"x1":120,"y1":120,"x2":122,"y2":180,"libre":true},{"x1":40,"y1":180,"x2":122,"y2":183,"libre":true},{"x1":0,"y1":120,"x2":40,"y2":180,"libre":false,"piezaId":"f1#5","rotada":true},{"x1":0,"y1":180,"x2":40,"y2":183,"libre":true}]},{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":32.2,"piezas":3,"cobro":{"nombre":"1/2","factor":0.5,"ancho":61,"alto":183,"monto":88.2,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":60,"y2":40,"libre":false,"piezaId":"f1#10","rotada":false},{"x1":60,"y1":0,"x2":61,"y2":183,"libre":true},{"x1":0,"y1":40,"x2":60,"y2":80,"libre":false,"piezaId":"f1#11","rotada":false},{"x1":0,"y1":80,"x2":60,"y2":120,"libre":false,"piezaId":"f1#12","rotada":false},{"x1":0,"y1":120,"x2":60,"y2":183,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":183,"libre":true,"sobrante":true}]}],"montoMaterial":235.2,"montoServicio":21.8,"total":257,"minutosLaser":22.74,"desglose":[{"etiqueta":"Plancha 1: completa (122×183)","monto":147},{"etiqueta":"Plancha 2: las piezas caben en 1/2 (61×183) → S/ 147.00 × 1/2 + 20 %","monto":88.2},{"etiqueta":"Corte láser: 12 piezas, 22.74 min","monto":21.8},{"etiqueta":"Total","monto":257,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Cristal' and detalle = '' and espesor_mm = 3))),
   null::jsonb,
   'Grabar el logo al centro de cada placa.', 2::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 291, 'SOPORTES DE ACRILICO 25MM X 40MM CRISTAL', 'ACC032', null,
   48::numeric, 6::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'entregado-tienda'), 643.1, 'transferencia', ((current_date + -12) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por, linea_posicion)
select id, 'diseno', 'pedidos/' || codigo || '/diseno/logo-recepcion.pdf', 'logo-recepcion.pdf', 'application/pdf', 860160, (select id from public.usuarios where usuario = 'ana'), 1
from seed_pedidos where clave = 'entregado-tienda';

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por, linea_posicion)
select id, 'foto_entrega', 'pedidos/' || codigo || '/foto_entrega/entrega-placas.jpg', 'entrega-placas.jpg', 'image/jpeg', 1258291, (select id from public.usuarios where usuario = 'ana'), null
from seed_pedidos where clave = 'entregado-tienda';

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-tienda'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -12) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-tienda'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -11) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-tienda'), 'listo', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -7) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-tienda'), 'entregado', 'logistica', null, (select id from public.usuarios where usuario = 'carla'), ((current_date + -6) + time '16:00') at time zone 'America/Lima');

-- anulado: anulado, SEED María Torres Huamán
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED María Torres Huamán', '988 112 233', array['CM', 'SP']::public.tipo_pedido[], null, 4,
    'a_cuenta', null, 352.82, 'domicilio', 'Av. Arequipa 2450, Lince', 'tienda',
    'anulado', 'La clienta canceló: compró el mueble armado en otro lado.', (current_date + -4), ((current_date + -10) + time '09:15') at time zone 'America/Lima',
    null, (current_date + -9),
    'Corte manual · Superficie sólida de acrílico · White (KS-003) · 6 mm: 3 piezas (3 × 80×25 cm) — 1 plancha de 122×244
1 × [PEG003] ADHESIVO 50 ML WHITE SUPERFICIE SOLIDA (KS-003)', null, null, null, null, (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'anulado', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'anulado'), 6, 'SEED María Torres Huamán', '41234567', '988 112 233',
    9002, 'S09002', 'sincronizada', 299, 53.82, 352.82,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + -10) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 269, 'SUPERFICIE SOLIDA DE ACRILICO WHITE (KS-003) 6MM 1.22X2.44', 'SS002', 'Corte manual · Superficie sólida de acrílico · White (KS-003) · 6 mm: 3 × 80×25 cm',
   1::numeric, 235.8::numeric, 254::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Superficie sólida de acrílico","color":"White (KS-003)","espesorMm":6,"modalidad":"manual","rotable":true,"piezas":[{"ancho":80,"alto":25,"cantidad":3}],"servicio":{"productoId":30,"codigo":"SRV001","nombre":"SERVICIO DE CORTE MANUAL"},"sobrantes":false,"formato":{"codigo":"SS002","ancho":122,"alto":244,"precio":393},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":244,"usoPct":20.2,"piezas":3,"cobro":{"nombre":"1/2","factor":0.5,"ancho":61,"alto":244,"monto":235.8,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":25,"y2":80,"libre":false,"piezaId":"f1#1","rotada":true},{"x1":25,"y1":0,"x2":50,"y2":80,"libre":false,"piezaId":"f1#2","rotada":true},{"x1":50,"y1":0,"x2":61,"y2":80,"libre":true},{"x1":0,"y1":80,"x2":25,"y2":160,"libre":false,"piezaId":"f1#3","rotada":true},{"x1":25,"y1":80,"x2":61,"y2":160,"libre":true},{"x1":0,"y1":160,"x2":61,"y2":244,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":244,"libre":true,"sobrante":true}]}],"montoMaterial":235.8,"montoServicio":18.2,"total":254,"minutosLaser":null,"desglose":[{"etiqueta":"Plancha 1: las piezas caben en 1/2 (61×244) → S/ 393.00 × 1/2 + 20 %","monto":235.8},{"etiqueta":"Corte manual: 3 piezas de 6 mm","monto":18.2},{"etiqueta":"Total","monto":254,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Superficie sólida de acrílico' and variante = '' and detalle = 'White (KS-003)' and espesor_mm = 6))),
   null::jsonb,
   null, null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 322, 'ADHESIVO 50 ML WHITE SUPERFICIE SOLIDA (KS-003)', 'PEG003', null,
   1::numeric, 45::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'anulado'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -10) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'anulado'), 'anulado', 'administracion', 'La clienta canceló: compró el mueble armado en otro lado.', (select id from public.usuarios where usuario = 'ana'), ((current_date + -9) + time '16:00') at time zone 'America/Lima');

-- entregado-provincia: entregado, SEED Constructora Sur EIRL
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    true, 'SEED Constructora Sur EIRL', '054 22 3344', array['SP', 'PT']::public.tipo_pedido[], 'letreros', 10,
    'credito', 30, 790.6, 'agencia', null, 'agencia',
    'entregado', null, (current_date + -2), ((current_date + -9) + time '09:15') at time zone 'America/Lima',
    (current_date + -1), null,
    '6 × [LTR-002] Letrero plano de acrílico con impresión UV (cuadrado o rectangular) — Medidas: 40 × 30 cm. Material: Acrílico ECO · Negro · 3 mm. Texto: Salida de emergencia. Personalización: Impresión UV a color
4 × [ACC017] BARRAS DE ACRILICO 6MM X 1200MM CRISTAL', null, null, 'F001-000236', (select id from public.trabajadores where nombre = 'Juan'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'entregado-provincia', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'entregado-provincia'), 7, 'SEED Constructora Sur EIRL', '20456789013', '054 22 3344',
    9003, 'S09003', 'sincronizada', 670, 120.6, 790.6,
    true, true, (select id from public.usuarios where usuario = 'ana'), ((current_date + -9) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'terminado'::public.tipo_linea, 902, 'Letrero plano de acrílico con impresión UV (cuadrado o rectangular)', 'LTR-002', 'Medidas: 40 × 30 cm. Material: Acrílico ECO · Negro · 3 mm. Texto: Salida de emergencia. Personalización: Impresión UV a color',
   6::numeric, 95::numeric, 570::numeric,
   null::jsonb,
   jsonb_set('{"version":1,"estandar":true,"productoCodigo":"LTR-002","tipoCodigo":"LTR","tipoNombre":"Letrero","nombre":"Letrero plano de acrílico con impresión UV (cuadrado o rectangular)","geometria":"lamina","medidas":{"m1":40,"m2":30},"medidaEstandar":false,"material":{"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Negro","espesorMm":3},"opciones":[{"clase":"personalizacion","nombre":"Impresión UV a color","extra":20}],"texto":"Salida de emergencia","notas":null,"areaUnidadM2":0.12,"areaManual":false,"mermaPct":15,"materiales":[{"productoId":24,"codigo":"F7E029","nombre":"ACRILICO ECO COLORES NEGRO 3MM 1.22X1.83","unidad":"plancha","cantidad":0.37,"precio":147,"esPlancha":true},{"productoId":292,"codigo":"ACC033","nombre":"SOPORTES DE ACRILICO 19MM X 30MM CRISTAL","unidad":"Unidades","cantidad":24,"precio":6,"esPlancha":false}],"costoMaterial":198.39,"factor":2,"precioSugerido":66.13,"precioUnitario":95,"reservar":false,"corte":null}'::jsonb, '{material,grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Colores' and detalle = 'Negro' and espesor_mm = 3))),
   null, null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 282, 'BARRAS DE ACRILICO 6MM X 1200MM CRISTAL', 'ACC017', null,
   4::numeric, 25::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado, observaciones_envio
) values (
  (select id from seed_pedidos where clave = 'entregado-provincia'), (select id from public.departamentos where nombre = 'Arequipa'),
  (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id where d.nombre = 'Arequipa' and pr.nombre = 'Arequipa'),
  'Shalom — Av. Ejército', 'Luis Quispe Mamani', 'DNI', '45871236', '959 334 120', 35, true, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'entregado-provincia'), 316.24, 'transferencia', ((current_date + -3) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por, linea_posicion)
select id, 'guia', 'pedidos/' || codigo || '/guia/guia-shalom-0098.pdf', 'guia-shalom-0098.pdf', 'application/pdf', 214000, (select id from public.usuarios where usuario = 'ana'), null
from seed_pedidos where clave = 'entregado-provincia';

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-provincia'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -9) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-provincia'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -8) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-provincia'), 'listo', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -5) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-provincia'), 'en_transito', 'logistica', null, (select id from public.usuarios where usuario = 'carla'), ((current_date + -4) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'entregado-provincia'), 'entregado', 'logistica', null, (select id from public.usuarios where usuario = 'carla'), ((current_date + -1) + time '16:00') at time zone 'America/Lima');

-- en-transito: en_transito, SEED Publicidad Lima SAC
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    true, 'SEED Publicidad Lima SAC', '01 444 5566', array['CL', 'SP']::public.tipo_pedido[], null, 44,
    'contado', null, 434.24, 'agencia', null, 'agencia',
    'en_transito', null, (current_date + 1), ((current_date + -6) + time '09:15') at time zone 'America/Lima',
    null, null,
    'Corte láser · Acrílico ECO · Cristal · 3 mm: 40 piezas (40 × 30×20 cm) — 2 planchas de 122×183
4 × [ACC035] SISTEMA GIRATORIO 100MM CRISTAL', null, null, null, (select id from public.trabajadores where nombre = 'Isaac'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'en-transito', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'en-transito'), 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    9004, 'S09004', 'sincronizada', 368, 66.24, 434.24,
    true, true, (select id from public.usuarios where usuario = 'ana'), ((current_date + -6) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', 'Corte láser · Acrílico ECO · Cristal · 3 mm: 40 × 30×20 cm',
   2::numeric, 95.55::numeric, 228::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Cristal","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":30,"alto":20,"cantidad":40}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E024","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":96.7,"piezas":36,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":30,"y2":20,"libre":false,"piezaId":"f1#1","rotada":false},{"x1":30,"y1":0,"x2":60,"y2":20,"libre":false,"piezaId":"f1#2","rotada":false},{"x1":60,"y1":0,"x2":90,"y2":20,"libre":false,"piezaId":"f1#3","rotada":false},{"x1":90,"y1":0,"x2":120,"y2":20,"libre":false,"piezaId":"f1#4","rotada":false},{"x1":120,"y1":0,"x2":122,"y2":20,"libre":true},{"x1":0,"y1":20,"x2":30,"y2":40,"libre":false,"piezaId":"f1#5","rotada":false},{"x1":30,"y1":20,"x2":60,"y2":40,"libre":false,"piezaId":"f1#6","rotada":false},{"x1":60,"y1":20,"x2":90,"y2":40,"libre":false,"piezaId":"f1#7","rotada":false},{"x1":90,"y1":20,"x2":120,"y2":40,"libre":false,"piezaId":"f1#8","rotada":false},{"x1":120,"y1":20,"x2":122,"y2":40,"libre":true},{"x1":0,"y1":40,"x2":30,"y2":60,"libre":false,"piezaId":"f1#9","rotada":false},{"x1":30,"y1":40,"x2":60,"y2":60,"libre":false,"piezaId":"f1#10","rotada":false},{"x1":60,"y1":40,"x2":90,"y2":60,"libre":false,"piezaId":"f1#11","rotada":false},{"x1":90,"y1":40,"x2":120,"y2":60,"libre":false,"piezaId":"f1#12","rotada":false},{"x1":120,"y1":40,"x2":122,"y2":60,"libre":true},{"x1":0,"y1":60,"x2":30,"y2":80,"libre":false,"piezaId":"f1#13","rotada":false},{"x1":30,"y1":60,"x2":60,"y2":80,"libre":false,"piezaId":"f1#14","rotada":false},{"x1":60,"y1":60,"x2":90,"y2":80,"libre":false,"piezaId":"f1#15","rotada":false},{"x1":90,"y1":60,"x2":120,"y2":80,"libre":false,"piezaId":"f1#16","rotada":false},{"x1":120,"y1":60,"x2":122,"y2":80,"libre":true},{"x1":0,"y1":80,"x2":30,"y2":100,"libre":false,"piezaId":"f1#17","rotada":false},{"x1":30,"y1":80,"x2":60,"y2":100,"libre":false,"piezaId":"f1#18","rotada":false},{"x1":60,"y1":80,"x2":90,"y2":100,"libre":false,"piezaId":"f1#19","rotada":false},{"x1":90,"y1":80,"x2":120,"y2":100,"libre":false,"piezaId":"f1#20","rotada":false},{"x1":120,"y1":80,"x2":122,"y2":100,"libre":true},{"x1":0,"y1":100,"x2":30,"y2":120,"libre":false,"piezaId":"f1#21","rotada":false},{"x1":30,"y1":100,"x2":60,"y2":120,"libre":false,"piezaId":"f1#25","rotada":false},{"x1":60,"y1":100,"x2":90,"y2":120,"libre":false,"piezaId":"f1#26","rotada":false},{"x1":90,"y1":100,"x2":120,"y2":120,"libre":false,"piezaId":"f1#27","rotada":false},{"x1":120,"y1":100,"x2":122,"y2":120,"libre":true},{"x1":30,"y1":120,"x2":60,"y2":140,"libre":false,"piezaId":"f1#28","rotada":false},{"x1":60,"y1":120,"x2":90,"y2":140,"libre":false,"piezaId":"f1#31","rotada":false},{"x1":90,"y1":120,"x2":120,"y2":140,"libre":false,"piezaId":"f1#32","rotada":false},{"x1":120,"y1":120,"x2":122,"y2":140,"libre":true},{"x1":60,"y1":140,"x2":90,"y2":160,"libre":false,"piezaId":"f1#33","rotada":false},{"x1":90,"y1":140,"x2":120,"y2":160,"libre":false,"piezaId":"f1#34","rotada":false},{"x1":120,"y1":140,"x2":122,"y2":160,"libre":true},{"x1":60,"y1":160,"x2":90,"y2":180,"libre":false,"piezaId":"f1#35","rotada":false},{"x1":90,"y1":160,"x2":120,"y2":180,"libre":false,"piezaId":"f1#36","rotada":false},{"x1":120,"y1":160,"x2":122,"y2":180,"libre":true},{"x1":60,"y1":180,"x2":122,"y2":183,"libre":true},{"x1":30,"y1":140,"x2":60,"y2":160,"libre":false,"piezaId":"f1#29","rotada":false},{"x1":30,"y1":160,"x2":60,"y2":180,"libre":false,"piezaId":"f1#30","rotada":false},{"x1":30,"y1":180,"x2":60,"y2":183,"libre":true},{"x1":0,"y1":120,"x2":30,"y2":140,"libre":false,"piezaId":"f1#22","rotada":false},{"x1":0,"y1":140,"x2":30,"y2":160,"libre":false,"piezaId":"f1#23","rotada":false},{"x1":0,"y1":160,"x2":30,"y2":180,"libre":false,"piezaId":"f1#24","rotada":false},{"x1":0,"y1":180,"x2":30,"y2":183,"libre":true}]},{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":10.7,"piezas":4,"cobro":{"nombre":"1/4","factor":0.25,"ancho":61,"alto":91.5,"monto":44.1,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":30,"y2":20,"libre":false,"piezaId":"f1#37","rotada":false},{"x1":30,"y1":0,"x2":60,"y2":20,"libre":false,"piezaId":"f1#38","rotada":false},{"x1":60,"y1":0,"x2":61,"y2":20,"libre":true},{"x1":0,"y1":20,"x2":30,"y2":40,"libre":false,"piezaId":"f1#39","rotada":false},{"x1":30,"y1":20,"x2":60,"y2":40,"libre":false,"piezaId":"f1#40","rotada":false},{"x1":60,"y1":20,"x2":61,"y2":40,"libre":true},{"x1":0,"y1":40,"x2":61,"y2":91.5,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":183,"libre":true,"sobrante":true},{"x1":0,"y1":91.5,"x2":61,"y2":183,"libre":true,"sobrante":true}]}],"montoMaterial":191.1,"montoServicio":36.9,"total":228,"minutosLaser":38.77,"desglose":[{"etiqueta":"Plancha 1: completa (122×183)","monto":147},{"etiqueta":"Plancha 2: las piezas caben en 1/4 (61×91.5) → S/ 147.00 × 1/4 + 20 %","monto":44.1},{"etiqueta":"Corte láser: 40 piezas, 38.77 min","monto":36.9},{"etiqueta":"Total","monto":228,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Cristal' and detalle = '' and espesor_mm = 3))),
   null::jsonb,
   null, null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 295, 'SISTEMA GIRATORIO 100MM CRISTAL', 'ACC035', null,
   4::numeric, 35::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado, observaciones_envio
) values (
  (select id from seed_pedidos where clave = 'en-transito'), (select id from public.departamentos where nombre = 'Cusco'),
  (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id where d.nombre = 'Cusco' and pr.nombre = 'Cusco'),
  'Marvisur', 'Rosa Huamán Ccori', 'DNI', '43219876', '984 551 207', 40, false, 'Flete se paga en destino.'
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'en-transito'), 434.24, 'yape_plin', ((current_date + -6) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'en-transito'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -6) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'en-transito'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -5) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'en-transito'), 'listo', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -2) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'en-transito'), 'en_transito', 'logistica', null, (select id from public.usuarios where usuario = 'carla'), ((current_date + -1) + time '16:00') at time zone 'America/Lima');

-- listo-tienda: listo, SEED María Torres Huamán
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED María Torres Huamán', '988 112 233', array['CM', 'SP']::public.tipo_pedido[], null, 5,
    'a_cuenta', null, 405.92, 'tienda', null, 'tienda',
    'listo', null, (current_date + 0), ((current_date + -5) + time '09:15') at time zone 'America/Lima',
    null, null,
    'Corte manual · Superficie sólida de acrílico · White (KS-003) · 6 mm: 3 piezas (1 × 120×60 cm, 2 × 40×30 cm) — 1 plancha de 122×244
  ↳ Pulir los cantos a brillo.
2 × [PEG003] ADHESIVO 50 ML WHITE SUPERFICIE SOLIDA (KS-003)', null, 'Avisar por WhatsApp cuando esté para recoger.', null, (select id from public.trabajadores where nombre = 'Clever'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'listo-tienda', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'listo-tienda'), 6, 'SEED María Torres Huamán', '41234567', '988 112 233',
    9005, 'S09005', 'sincronizada', 344, 61.92, 405.92,
    true, true, (select id from public.usuarios where usuario = 'ana'), ((current_date + -5) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 269, 'SUPERFICIE SOLIDA DE ACRILICO WHITE (KS-003) 6MM 1.22X2.44', 'SS002', 'Corte manual · Superficie sólida de acrílico · White (KS-003) · 6 mm: 1 × 120×60 cm, 2 × 40×30 cm',
   1::numeric, 235.8::numeric, 254::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Superficie sólida de acrílico","color":"White (KS-003)","espesorMm":6,"modalidad":"manual","rotable":true,"piezas":[{"ancho":120,"alto":60,"cantidad":1},{"ancho":40,"alto":30,"cantidad":2}],"servicio":{"productoId":30,"codigo":"SRV001","nombre":"SERVICIO DE CORTE MANUAL"},"sobrantes":false,"formato":{"codigo":"SS002","ancho":122,"alto":244,"precio":393},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":244,"usoPct":32.2,"piezas":3,"cobro":{"nombre":"1/2","factor":0.5,"ancho":61,"alto":244,"monto":235.8,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":60,"y2":120,"libre":false,"piezaId":"f1#1","rotada":true},{"x1":60,"y1":0,"x2":61,"y2":244,"libre":true},{"x1":0,"y1":120,"x2":40,"y2":150,"libre":false,"piezaId":"f2#1","rotada":false},{"x1":40,"y1":120,"x2":60,"y2":244,"libre":true},{"x1":0,"y1":150,"x2":40,"y2":180,"libre":false,"piezaId":"f2#2","rotada":false},{"x1":0,"y1":180,"x2":40,"y2":244,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":244,"libre":true,"sobrante":true}]}],"montoMaterial":235.8,"montoServicio":18.2,"total":254,"minutosLaser":null,"desglose":[{"etiqueta":"Plancha 1: las piezas caben en 1/2 (61×244) → S/ 393.00 × 1/2 + 20 %","monto":235.8},{"etiqueta":"Corte manual: 3 piezas de 6 mm","monto":18.2},{"etiqueta":"Total","monto":254,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Superficie sólida de acrílico' and variante = '' and detalle = 'White (KS-003)' and espesor_mm = 6))),
   null::jsonb,
   'Pulir los cantos a brillo.', null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 322, 'ADHESIVO 50 ML WHITE SUPERFICIE SOLIDA (KS-003)', 'PEG003', null,
   2::numeric, 45::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'listo-tienda'), 202.96, 'efectivo', ((current_date + -5) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'listo-tienda'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -5) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'listo-tienda'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -4) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'listo-tienda'), 'listo', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -1) + time '16:00') at time zone 'America/Lima');

-- listo-domicilio: listo, SEED Constructora Sur EIRL
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED Constructora Sur EIRL', '054 22 3344', array['SP', 'PT']::public.tipo_pedido[], 'cajas', 11,
    'credito', 15, 1097.4, 'domicilio', 'Calle Los Pinos 145, Urb. Santa Patricia, La Molina', 'taller',
    'listo', null, (current_date + 1), ((current_date + -5) + time '09:15') at time zone 'America/Lima',
    null, null,
    '10 × [CAJ-006] Caja para rifas y sorteos — Medidas: 30 × 30 × 30 cm. Material: Acrílico ECO · Cristal · 3 mm. Acabado: Brillante (pulido). Complementos: Cerradura con llave. Notas: Ranura de 2 cm en la tapa
1 × [SRV004] SERVICIO DE INSTALACION', null, null, null, (select id from public.trabajadores where nombre = 'John'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'listo-domicilio', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'listo-domicilio'), 7, 'SEED Constructora Sur EIRL', '20456789013', '054 22 3344',
    9006, 'S09006', 'sincronizada', 930, 167.4, 1097.4,
    true, true, (select id from public.usuarios where usuario = 'ana'), ((current_date + -5) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'terminado'::public.tipo_linea, 901, 'Caja para rifas y sorteos', 'CAJ-006', 'Medidas: 30 × 30 × 30 cm. Material: Acrílico ECO · Cristal · 3 mm. Acabado: Brillante (pulido). Complementos: Cerradura con llave. Notas: Ranura de 2 cm en la tapa',
   10::numeric, 85::numeric, 850::numeric,
   null::jsonb,
   jsonb_set('{"version":1,"estandar":true,"productoCodigo":"CAJ-006","tipoCodigo":"CAJ","tipoNombre":"Caja","nombre":"Caja para rifas y sorteos","geometria":"caja_cerrada","medidas":{"m1":30,"m2":30,"m3":30},"medidaEstandar":false,"material":{"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Cristal","espesorMm":3},"opciones":[{"clase":"complemento","nombre":"Cerradura con llave","extra":15},{"clase":"acabado","nombre":"Brillante (pulido)","extra":0}],"texto":null,"notas":"Ranura de 2 cm en la tapa","areaUnidadM2":0.54,"areaManual":false,"mermaPct":15,"materiales":[{"productoId":20,"codigo":"F7E024","nombre":"ACRILICO ECO CRISTAL 3MM 1.22X1.83","unidad":"plancha","cantidad":2.78,"precio":147,"esPlancha":true},{"productoId":271,"codigo":"ACC003","nombre":"BISAGRAS 25MM X 33MM CRISTAL","unidad":"Unidades","cantidad":20,"precio":8,"esPlancha":false}],"costoMaterial":568.66,"factor":2,"precioSugerido":113.73,"precioUnitario":85,"reservar":false,"corte":null}'::jsonb, '{material,grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Cristal' and detalle = '' and espesor_mm = 3))),
   null, null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 329, 'SERVICIO DE INSTALACION', 'SRV004', null,
   1::numeric, 80::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'listo-domicilio'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -5) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'listo-domicilio'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -4) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'listo-domicilio'), 'listo', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + 0) + time '16:00') at time zone 'America/Lima');

-- observado: observado, SEED Publicidad Lima SAC
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED Publicidad Lima SAC', '01 444 5566', array['CL']::public.tipo_pedido[], null, 6,
    'a_cuenta', null, 186.44, 'taller', null, 'taller',
    'observado', 'El cliente cambió el logo: esperar el archivo nuevo antes de cortar.', (current_date + 1), ((current_date + -4) + time '09:15') at time zone 'America/Lima',
    null, null,
    'Corte láser · Acrílico ECO · Negro · 3 mm: 6 piezas (6 × 50×50 cm) — 1 plancha de 122×183
  ↳ Grabado del logo en la esquina inferior derecha.', 'El cliente manda el logo en vectores (AI o PDF).', null, null, (select id from public.trabajadores where nombre = 'Angel'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'observado', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'observado'), 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    9007, 'S09007', 'sincronizada', 158, 28.44, 186.44,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + -4) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 24, 'ACRILICO ECO COLORES NEGRO 3MM 1.22X1.83', 'F7E029', 'Corte láser · Acrílico ECO · Negro · 3 mm: 6 × 50×50 cm',
   1::numeric, 147::numeric, 158::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Negro","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":50,"alto":50,"cantidad":6}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E029","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":67.2,"piezas":6,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":50,"y2":50,"libre":false,"piezaId":"f1#1","rotada":false},{"x1":50,"y1":0,"x2":100,"y2":50,"libre":false,"piezaId":"f1#2","rotada":false},{"x1":100,"y1":0,"x2":122,"y2":50,"libre":true},{"x1":0,"y1":50,"x2":50,"y2":100,"libre":false,"piezaId":"f1#3","rotada":false},{"x1":50,"y1":50,"x2":100,"y2":100,"libre":false,"piezaId":"f1#4","rotada":false},{"x1":100,"y1":50,"x2":122,"y2":100,"libre":true},{"x1":0,"y1":100,"x2":50,"y2":150,"libre":false,"piezaId":"f1#5","rotada":false},{"x1":50,"y1":100,"x2":100,"y2":150,"libre":false,"piezaId":"f1#6","rotada":false},{"x1":100,"y1":100,"x2":122,"y2":150,"libre":true},{"x1":0,"y1":150,"x2":122,"y2":183,"libre":true}]}],"montoMaterial":147,"montoServicio":11,"total":158,"minutosLaser":11.37,"desglose":[{"etiqueta":"Plancha 1: completa (122×183)","monto":147},{"etiqueta":"Corte láser: 6 piezas, 11.37 min","monto":11},{"etiqueta":"Total","monto":158,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Colores' and detalle = 'Negro' and espesor_mm = 3))),
   null::jsonb,
   'Grabado del logo en la esquina inferior derecha.', null::numeric)
) as l;

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'observado'), 93.22, 'transferencia', ((current_date + -4) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por, linea_posicion)
select id, 'diseno', 'pedidos/' || codigo || '/diseno/logo-v1.pdf', 'logo-v1.pdf', 'application/pdf', 512000, (select id from public.usuarios where usuario = 'ana'), 1
from seed_pedidos where clave = 'observado';

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'observado'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -4) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'observado'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -3) + time '16:00') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'observado'), 'observado', 'operaciones', 'El cliente cambió el logo: esperar el archivo nuevo antes de cortar.', (select id from public.usuarios where usuario = 'miguel'), ((current_date + -2) + time '16:00') at time zone 'America/Lima');

-- vencido: en_proceso, SEED María Torres Huamán
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED María Torres Huamán', '988 112 233', array['PT']::public.tipo_pedido[], 'cajas', 3,
    'contado', null, 318.6, 'tienda', null, 'taller',
    'en_proceso', null, (current_date + -1), ((current_date + -4) + time '09:15') at time zone 'America/Lima',
    null, null,
    '3 × [CAJ-006] Caja para rifas y sorteos — Medidas: 30 × 30 × 30 cm. Material: Acrílico ECO · Cristal · 3 mm. Acabado: Brillante (pulido). Complementos: Cerradura con llave. Notas: Ranura de 2 cm en la tapa', null, null, null, (select id from public.trabajadores where nombre = 'Isaac'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'vencido', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'vencido'), 6, 'SEED María Torres Huamán', '41234567', '988 112 233',
    9008, 'S09008', 'sincronizada', 270, 48.6, 318.6,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + -4) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'terminado'::public.tipo_linea, 901, 'Caja para rifas y sorteos', 'CAJ-006', 'Medidas: 30 × 30 × 30 cm. Material: Acrílico ECO · Cristal · 3 mm. Acabado: Brillante (pulido). Complementos: Cerradura con llave. Notas: Ranura de 2 cm en la tapa',
   3::numeric, 90::numeric, 270::numeric,
   null::jsonb,
   jsonb_set('{"version":1,"estandar":true,"productoCodigo":"CAJ-006","tipoCodigo":"CAJ","tipoNombre":"Caja","nombre":"Caja para rifas y sorteos","geometria":"caja_cerrada","medidas":{"m1":30,"m2":30,"m3":30},"medidaEstandar":false,"material":{"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Cristal","espesorMm":3},"opciones":[{"clase":"complemento","nombre":"Cerradura con llave","extra":15},{"clase":"acabado","nombre":"Brillante (pulido)","extra":0}],"texto":null,"notas":"Ranura de 2 cm en la tapa","areaUnidadM2":0.54,"areaManual":false,"mermaPct":15,"materiales":[{"productoId":20,"codigo":"F7E024","nombre":"ACRILICO ECO CRISTAL 3MM 1.22X1.83","unidad":"plancha","cantidad":0.83,"precio":147,"esPlancha":true},{"productoId":271,"codigo":"ACC003","nombre":"BISAGRAS 25MM X 33MM CRISTAL","unidad":"Unidades","cantidad":6,"precio":8,"esPlancha":false}],"costoMaterial":170.01,"factor":2,"precioSugerido":113.34,"precioUnitario":90,"reservar":false,"corte":null}'::jsonb, '{material,grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Cristal' and detalle = '' and espesor_mm = 3))),
   null, null::numeric)
) as l;

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'vencido'), 318.6, 'tarjeta', ((current_date + -4) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'vencido'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -4) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'vencido'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -3) + time '16:00') at time zone 'America/Lima');

-- hoy: en_proceso, SEED Constructora Sur EIRL
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED Constructora Sur EIRL', '054 22 3344', array['CL', 'SP']::public.tipo_pedido[], null, 60,
    'credito', 7, 639.56, 'taller', null, 'taller',
    'en_proceso', null, (current_date + 0), ((current_date + -3) + time '09:15') at time zone 'America/Lima',
    null, null,
    'Corte láser · Acrílico ECO · Negro · 3 mm: 24 piezas (24 × 30×40 cm) — 2 planchas de 122×183
  ↳ Cantos flameados.
24 × [ACC003] BISAGRAS 25MM X 33MM CRISTAL
12 × [ACC038] MANIJAS DE ACRILICO (JALADOR) 20MM CRISTAL TIPO CORONA', null, null, null, (select id from public.trabajadores where nombre = 'Juan'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'hoy', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'hoy'), 7, 'SEED Constructora Sur EIRL', '20456789013', '054 22 3344',
    9009, 'S09009', 'sincronizada', 542, 97.56, 639.56,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + -3) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 24, 'ACRILICO ECO COLORES NEGRO 3MM 1.22X1.83', 'F7E029', 'Corte láser · Acrílico ECO · Negro · 3 mm: 24 × 30×40 cm',
   2::numeric, 117.6::numeric, 266::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Negro","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":30,"alto":40,"cantidad":24}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E029","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":96.7,"piezas":18,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":40,"y2":30,"libre":false,"piezaId":"f1#1","rotada":true},{"x1":40,"y1":0,"x2":80,"y2":30,"libre":false,"piezaId":"f1#2","rotada":true},{"x1":80,"y1":0,"x2":120,"y2":30,"libre":false,"piezaId":"f1#3","rotada":true},{"x1":120,"y1":0,"x2":122,"y2":30,"libre":true},{"x1":0,"y1":30,"x2":40,"y2":60,"libre":false,"piezaId":"f1#4","rotada":true},{"x1":40,"y1":30,"x2":80,"y2":60,"libre":false,"piezaId":"f1#5","rotada":true},{"x1":80,"y1":30,"x2":120,"y2":60,"libre":false,"piezaId":"f1#6","rotada":true},{"x1":120,"y1":30,"x2":122,"y2":60,"libre":true},{"x1":0,"y1":60,"x2":40,"y2":90,"libre":false,"piezaId":"f1#7","rotada":true},{"x1":40,"y1":60,"x2":80,"y2":90,"libre":false,"piezaId":"f1#8","rotada":true},{"x1":80,"y1":60,"x2":120,"y2":90,"libre":false,"piezaId":"f1#9","rotada":true},{"x1":120,"y1":60,"x2":122,"y2":90,"libre":true},{"x1":0,"y1":90,"x2":40,"y2":120,"libre":false,"piezaId":"f1#10","rotada":true},{"x1":40,"y1":90,"x2":80,"y2":120,"libre":false,"piezaId":"f1#13","rotada":true},{"x1":80,"y1":90,"x2":120,"y2":120,"libre":false,"piezaId":"f1#14","rotada":true},{"x1":120,"y1":90,"x2":122,"y2":120,"libre":true},{"x1":40,"y1":120,"x2":80,"y2":150,"libre":false,"piezaId":"f1#15","rotada":true},{"x1":80,"y1":120,"x2":120,"y2":150,"libre":false,"piezaId":"f1#16","rotada":true},{"x1":120,"y1":120,"x2":122,"y2":150,"libre":true},{"x1":40,"y1":150,"x2":80,"y2":180,"libre":false,"piezaId":"f1#17","rotada":true},{"x1":80,"y1":150,"x2":120,"y2":180,"libre":false,"piezaId":"f1#18","rotada":true},{"x1":120,"y1":150,"x2":122,"y2":180,"libre":true},{"x1":40,"y1":180,"x2":122,"y2":183,"libre":true},{"x1":0,"y1":120,"x2":40,"y2":150,"libre":false,"piezaId":"f1#11","rotada":true},{"x1":0,"y1":150,"x2":40,"y2":180,"libre":false,"piezaId":"f1#12","rotada":true},{"x1":0,"y1":180,"x2":40,"y2":183,"libre":true}]},{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":32.2,"piezas":6,"cobro":{"nombre":"1/2","factor":0.5,"ancho":61,"alto":183,"monto":88.2,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":30,"y2":40,"libre":false,"piezaId":"f1#19","rotada":false},{"x1":30,"y1":0,"x2":60,"y2":40,"libre":false,"piezaId":"f1#20","rotada":false},{"x1":60,"y1":0,"x2":61,"y2":40,"libre":true},{"x1":0,"y1":40,"x2":30,"y2":80,"libre":false,"piezaId":"f1#21","rotada":false},{"x1":30,"y1":40,"x2":60,"y2":80,"libre":false,"piezaId":"f1#22","rotada":false},{"x1":60,"y1":40,"x2":61,"y2":80,"libre":true},{"x1":0,"y1":80,"x2":30,"y2":120,"libre":false,"piezaId":"f1#23","rotada":false},{"x1":30,"y1":80,"x2":60,"y2":120,"libre":false,"piezaId":"f1#24","rotada":false},{"x1":60,"y1":80,"x2":61,"y2":120,"libre":true},{"x1":0,"y1":120,"x2":61,"y2":183,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":183,"libre":true,"sobrante":true}]}],"montoMaterial":235.2,"montoServicio":30.8,"total":266,"minutosLaser":32.15,"desglose":[{"etiqueta":"Plancha 1: completa (122×183)","monto":147},{"etiqueta":"Plancha 2: las piezas caben en 1/2 (61×183) → S/ 147.00 × 1/2 + 20 %","monto":88.2},{"etiqueta":"Corte láser: 24 piezas, 32.15 min","monto":30.8},{"etiqueta":"Total","monto":266,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Colores' and detalle = 'Negro' and espesor_mm = 3))),
   null::jsonb,
   'Cantos flameados.', null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 271, 'BISAGRAS 25MM X 33MM CRISTAL', 'ACC003', null,
   24::numeric, 8::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric),
  (3::smallint, 'producto'::public.tipo_linea, 301, 'MANIJAS DE ACRILICO (JALADOR) 20MM CRISTAL TIPO CORONA', 'ACC038', null,
   12::numeric, 7::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por, linea_posicion)
select id, 'diseno', 'pedidos/' || codigo || '/diseno/vitrinas-plano.dxf', 'vitrinas-plano.dxf', 'image/vnd.dxf', 98304, (select id from public.usuarios where usuario = 'ana'), 1
from seed_pedidos where clave = 'hoy';

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por, linea_posicion)
select id, 'diseno', 'pedidos/' || codigo || '/diseno/referencia-vitrina.jpg', 'referencia-vitrina.jpg', 'image/jpeg', 734003, (select id from public.usuarios where usuario = 'ana'), null
from seed_pedidos where clave = 'hoy';

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'hoy'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -3) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'hoy'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -2) + time '16:00') at time zone 'America/Lima');

-- en-proceso: en_proceso, SEED Publicidad Lima SAC
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED Publicidad Lima SAC', '01 444 5566', array['CL']::public.tipo_pedido[], null, 80,
    'a_cuenta', null, 282.02, 'tienda', null, 'taller',
    'en_proceso', null, (current_date + 3), ((current_date + -2) + time '09:15') at time zone 'America/Lima',
    null, null,
    'Corte láser · Acrílico ECO · Cristal · 3 mm: 30 piezas (30 × 21×29.7 cm) — 1 plancha de 122×183
Corte láser · Acrílico ECO · Negro · 3 mm: 50 piezas (50 × 10×10 cm) — 1 plancha de 122×183
  ↳ Perforar 4 agujeros de 5 mm en las esquinas.', null, null, null, (select id from public.trabajadores where nombre = 'Manuel'), (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'en-proceso', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'en-proceso'), 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    9010, 'S09010', 'sincronizada', 239, 43.02, 282.02,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + -2) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', 'Corte láser · Acrílico ECO · Cristal · 3 mm: 30 × 21×29.7 cm',
   1::numeric, 147::numeric, 175::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Cristal","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":21,"alto":29.7,"cantidad":30}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E024","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":83.8,"piezas":30,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":29.7,"y2":21,"libre":false,"piezaId":"f1#1","rotada":true},{"x1":29.7,"y1":0,"x2":59.4,"y2":21,"libre":false,"piezaId":"f1#2","rotada":true},{"x1":59.4,"y1":0,"x2":89.1,"y2":21,"libre":false,"piezaId":"f1#3","rotada":true},{"x1":89.1,"y1":0,"x2":118.8,"y2":21,"libre":false,"piezaId":"f1#4","rotada":true},{"x1":118.8,"y1":0,"x2":122,"y2":21,"libre":true},{"x1":0,"y1":21,"x2":29.7,"y2":42,"libre":false,"piezaId":"f1#5","rotada":true},{"x1":29.7,"y1":21,"x2":59.4,"y2":42,"libre":false,"piezaId":"f1#6","rotada":true},{"x1":59.4,"y1":21,"x2":89.1,"y2":42,"libre":false,"piezaId":"f1#7","rotada":true},{"x1":89.1,"y1":21,"x2":118.8,"y2":42,"libre":false,"piezaId":"f1#8","rotada":true},{"x1":118.8,"y1":21,"x2":122,"y2":42,"libre":true},{"x1":0,"y1":42,"x2":29.7,"y2":63,"libre":false,"piezaId":"f1#9","rotada":true},{"x1":29.7,"y1":42,"x2":59.4,"y2":63,"libre":false,"piezaId":"f1#10","rotada":true},{"x1":59.4,"y1":42,"x2":89.1,"y2":63,"libre":false,"piezaId":"f1#11","rotada":true},{"x1":89.1,"y1":42,"x2":118.8,"y2":63,"libre":false,"piezaId":"f1#12","rotada":true},{"x1":118.8,"y1":42,"x2":122,"y2":63,"libre":true},{"x1":0,"y1":63,"x2":29.7,"y2":84,"libre":false,"piezaId":"f1#13","rotada":true},{"x1":29.7,"y1":63,"x2":59.4,"y2":84,"libre":false,"piezaId":"f1#14","rotada":true},{"x1":59.4,"y1":63,"x2":89.1,"y2":84,"libre":false,"piezaId":"f1#15","rotada":true},{"x1":89.1,"y1":63,"x2":118.8,"y2":84,"libre":false,"piezaId":"f1#16","rotada":true},{"x1":118.8,"y1":63,"x2":122,"y2":84,"libre":true},{"x1":0,"y1":84,"x2":29.7,"y2":105,"libre":false,"piezaId":"f1#17","rotada":true},{"x1":29.7,"y1":84,"x2":59.4,"y2":105,"libre":false,"piezaId":"f1#21","rotada":true},{"x1":59.4,"y1":84,"x2":89.1,"y2":105,"libre":false,"piezaId":"f1#22","rotada":true},{"x1":89.1,"y1":84,"x2":118.8,"y2":105,"libre":false,"piezaId":"f1#23","rotada":true},{"x1":118.8,"y1":84,"x2":122,"y2":105,"libre":true},{"x1":29.7,"y1":105,"x2":59.4,"y2":126,"libre":false,"piezaId":"f1#24","rotada":true},{"x1":59.4,"y1":105,"x2":89.1,"y2":126,"libre":false,"piezaId":"f1#25","rotada":true},{"x1":89.1,"y1":105,"x2":118.8,"y2":126,"libre":false,"piezaId":"f1#26","rotada":true},{"x1":118.8,"y1":105,"x2":122,"y2":126,"libre":true},{"x1":29.7,"y1":126,"x2":59.4,"y2":147,"libre":false,"piezaId":"f1#27","rotada":true},{"x1":59.4,"y1":126,"x2":89.1,"y2":147,"libre":false,"piezaId":"f1#29","rotada":true},{"x1":89.1,"y1":126,"x2":118.8,"y2":147,"libre":false,"piezaId":"f1#30","rotada":true},{"x1":118.8,"y1":126,"x2":122,"y2":147,"libre":true},{"x1":59.4,"y1":147,"x2":122,"y2":183,"libre":true},{"x1":29.7,"y1":147,"x2":59.4,"y2":168,"libre":false,"piezaId":"f1#28","rotada":true},{"x1":29.7,"y1":168,"x2":59.4,"y2":183,"libre":true},{"x1":0,"y1":105,"x2":29.7,"y2":126,"libre":false,"piezaId":"f1#18","rotada":true},{"x1":0,"y1":126,"x2":29.7,"y2":147,"libre":false,"piezaId":"f1#19","rotada":true},{"x1":0,"y1":147,"x2":29.7,"y2":168,"libre":false,"piezaId":"f1#20","rotada":true},{"x1":0,"y1":168,"x2":29.7,"y2":183,"libre":true}]}],"montoMaterial":147,"montoServicio":28,"total":175,"minutosLaser":29.47,"desglose":[{"etiqueta":"Plancha 1: completa (122×183)","monto":147},{"etiqueta":"Corte láser: 30 piezas, 29.47 min","monto":28},{"etiqueta":"Total","monto":175,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Cristal' and detalle = '' and espesor_mm = 3))),
   null::jsonb,
   null, null::numeric),
  (2::smallint, 'corte'::public.tipo_linea, 24, 'ACRILICO ECO COLORES NEGRO 3MM 1.22X1.83', 'F7E029', 'Corte láser · Acrílico ECO · Negro · 3 mm: 50 × 10×10 cm',
   1::numeric, 44.1::numeric, 64::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Negro","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":10,"alto":10,"cantidad":50}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E029","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":22.4,"piezas":50,"cobro":{"nombre":"1/4","factor":0.25,"ancho":61,"alto":91.5,"monto":44.1,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":10,"y2":10,"libre":false,"piezaId":"f1#1","rotada":false},{"x1":10,"y1":0,"x2":20,"y2":10,"libre":false,"piezaId":"f1#2","rotada":false},{"x1":20,"y1":0,"x2":30,"y2":10,"libre":false,"piezaId":"f1#3","rotada":false},{"x1":30,"y1":0,"x2":40,"y2":10,"libre":false,"piezaId":"f1#4","rotada":false},{"x1":40,"y1":0,"x2":50,"y2":10,"libre":false,"piezaId":"f1#5","rotada":false},{"x1":50,"y1":0,"x2":60,"y2":10,"libre":false,"piezaId":"f1#6","rotada":false},{"x1":60,"y1":0,"x2":61,"y2":10,"libre":true},{"x1":0,"y1":10,"x2":10,"y2":20,"libre":false,"piezaId":"f1#7","rotada":false},{"x1":10,"y1":10,"x2":20,"y2":20,"libre":false,"piezaId":"f1#8","rotada":false},{"x1":20,"y1":10,"x2":30,"y2":20,"libre":false,"piezaId":"f1#9","rotada":false},{"x1":30,"y1":10,"x2":40,"y2":20,"libre":false,"piezaId":"f1#10","rotada":false},{"x1":40,"y1":10,"x2":50,"y2":20,"libre":false,"piezaId":"f1#11","rotada":false},{"x1":50,"y1":10,"x2":60,"y2":20,"libre":false,"piezaId":"f1#12","rotada":false},{"x1":60,"y1":10,"x2":61,"y2":20,"libre":true},{"x1":0,"y1":20,"x2":10,"y2":30,"libre":false,"piezaId":"f1#13","rotada":false},{"x1":10,"y1":20,"x2":20,"y2":30,"libre":false,"piezaId":"f1#14","rotada":false},{"x1":20,"y1":20,"x2":30,"y2":30,"libre":false,"piezaId":"f1#15","rotada":false},{"x1":30,"y1":20,"x2":40,"y2":30,"libre":false,"piezaId":"f1#16","rotada":false},{"x1":40,"y1":20,"x2":50,"y2":30,"libre":false,"piezaId":"f1#17","rotada":false},{"x1":50,"y1":20,"x2":60,"y2":30,"libre":false,"piezaId":"f1#18","rotada":false},{"x1":60,"y1":20,"x2":61,"y2":30,"libre":true},{"x1":0,"y1":30,"x2":10,"y2":40,"libre":false,"piezaId":"f1#19","rotada":false},{"x1":10,"y1":30,"x2":20,"y2":40,"libre":false,"piezaId":"f1#20","rotada":false},{"x1":20,"y1":30,"x2":30,"y2":40,"libre":false,"piezaId":"f1#21","rotada":false},{"x1":30,"y1":30,"x2":40,"y2":40,"libre":false,"piezaId":"f1#22","rotada":false},{"x1":40,"y1":30,"x2":50,"y2":40,"libre":false,"piezaId":"f1#23","rotada":false},{"x1":50,"y1":30,"x2":60,"y2":40,"libre":false,"piezaId":"f1#24","rotada":false},{"x1":60,"y1":30,"x2":61,"y2":40,"libre":true},{"x1":0,"y1":40,"x2":10,"y2":50,"libre":false,"piezaId":"f1#25","rotada":false},{"x1":10,"y1":40,"x2":20,"y2":50,"libre":false,"piezaId":"f1#30","rotada":false},{"x1":20,"y1":40,"x2":30,"y2":50,"libre":false,"piezaId":"f1#31","rotada":false},{"x1":30,"y1":40,"x2":40,"y2":50,"libre":false,"piezaId":"f1#32","rotada":false},{"x1":40,"y1":40,"x2":50,"y2":50,"libre":false,"piezaId":"f1#33","rotada":false},{"x1":50,"y1":40,"x2":60,"y2":50,"libre":false,"piezaId":"f1#34","rotada":false},{"x1":60,"y1":40,"x2":61,"y2":50,"libre":true},{"x1":10,"y1":50,"x2":20,"y2":60,"libre":false,"piezaId":"f1#35","rotada":false},{"x1":20,"y1":50,"x2":30,"y2":60,"libre":false,"piezaId":"f1#39","rotada":false},{"x1":30,"y1":50,"x2":40,"y2":60,"libre":false,"piezaId":"f1#40","rotada":false},{"x1":40,"y1":50,"x2":50,"y2":60,"libre":false,"piezaId":"f1#41","rotada":false},{"x1":50,"y1":50,"x2":60,"y2":60,"libre":false,"piezaId":"f1#42","rotada":false},{"x1":60,"y1":50,"x2":61,"y2":60,"libre":true},{"x1":20,"y1":60,"x2":30,"y2":70,"libre":false,"piezaId":"f1#43","rotada":false},{"x1":30,"y1":60,"x2":40,"y2":70,"libre":false,"piezaId":"f1#46","rotada":false},{"x1":40,"y1":60,"x2":50,"y2":70,"libre":false,"piezaId":"f1#47","rotada":false},{"x1":50,"y1":60,"x2":60,"y2":70,"libre":false,"piezaId":"f1#48","rotada":false},{"x1":60,"y1":60,"x2":61,"y2":70,"libre":true},{"x1":30,"y1":70,"x2":40,"y2":80,"libre":false,"piezaId":"f1#49","rotada":false},{"x1":40,"y1":70,"x2":61,"y2":91.5,"libre":true},{"x1":30,"y1":80,"x2":40,"y2":90,"libre":false,"piezaId":"f1#50","rotada":false},{"x1":30,"y1":90,"x2":40,"y2":91.5,"libre":true},{"x1":20,"y1":70,"x2":30,"y2":80,"libre":false,"piezaId":"f1#44","rotada":false},{"x1":20,"y1":80,"x2":30,"y2":90,"libre":false,"piezaId":"f1#45","rotada":false},{"x1":20,"y1":90,"x2":30,"y2":91.5,"libre":true},{"x1":10,"y1":60,"x2":20,"y2":70,"libre":false,"piezaId":"f1#36","rotada":false},{"x1":10,"y1":70,"x2":20,"y2":80,"libre":false,"piezaId":"f1#37","rotada":false},{"x1":10,"y1":80,"x2":20,"y2":90,"libre":false,"piezaId":"f1#38","rotada":false},{"x1":10,"y1":90,"x2":20,"y2":91.5,"libre":true},{"x1":0,"y1":50,"x2":10,"y2":60,"libre":false,"piezaId":"f1#26","rotada":false},{"x1":0,"y1":60,"x2":10,"y2":70,"libre":false,"piezaId":"f1#27","rotada":false},{"x1":0,"y1":70,"x2":10,"y2":80,"libre":false,"piezaId":"f1#28","rotada":false},{"x1":0,"y1":80,"x2":10,"y2":90,"libre":false,"piezaId":"f1#29","rotada":false},{"x1":0,"y1":90,"x2":10,"y2":91.5,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":183,"libre":true,"sobrante":true},{"x1":0,"y1":91.5,"x2":61,"y2":183,"libre":true,"sobrante":true}]}],"montoMaterial":44.1,"montoServicio":19.9,"total":64,"minutosLaser":20.69,"desglose":[{"etiqueta":"Plancha 1: las piezas caben en 1/4 (61×91.5) → S/ 147.00 × 1/4 + 20 %","monto":44.1},{"etiqueta":"Corte láser: 50 piezas, 20.69 min","monto":19.9},{"etiqueta":"Total","monto":64,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Colores' and detalle = 'Negro' and espesor_mm = 3))),
   null::jsonb,
   'Perforar 4 agujeros de 5 mm en las esquinas.', null::numeric)
) as l;

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'en-proceso'), 169.21, 'yape_plin', ((current_date + -2) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'en-proceso'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -2) + time '09:15') at time zone 'America/Lima');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'en-proceso'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where usuario = 'miguel'), ((current_date + -1) + time '16:00') at time zone 'America/Lima');

-- registrado-provincia: registrado, SEED Constructora Sur EIRL
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    true, 'SEED Constructora Sur EIRL', '054 22 3344', array['SP', 'PT']::public.tipo_pedido[], 'letreros', 12,
    'a_cuenta', null, 575.84, 'agencia', null, 'taller',
    'registrado', null, (current_date + 6), ((current_date + -1) + time '09:15') at time zone 'America/Lima',
    null, null,
    '4 × [LTR-002] Letrero plano de acrílico con impresión UV (cuadrado o rectangular) — Medidas: 40 × 30 cm. Material: Acrílico ECO · Negro · 3 mm. Texto: Baños. Personalización: Impresión UV a color
8 × [ACC033] SOPORTES DE ACRILICO 19MM X 30MM CRISTAL', null, null, null, null, (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'registrado-provincia', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'registrado-provincia'), 7, 'SEED Constructora Sur EIRL', '20456789013', '054 22 3344',
    9011, 'S09011', 'sincronizada', 488, 87.84, 575.84,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + -1) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'terminado'::public.tipo_linea, 902, 'Letrero plano de acrílico con impresión UV (cuadrado o rectangular)', 'LTR-002', 'Medidas: 40 × 30 cm. Material: Acrílico ECO · Negro · 3 mm. Texto: Baños. Personalización: Impresión UV a color',
   4::numeric, 110::numeric, 440::numeric,
   null::jsonb,
   jsonb_set('{"version":1,"estandar":true,"productoCodigo":"LTR-002","tipoCodigo":"LTR","tipoNombre":"Letrero","nombre":"Letrero plano de acrílico con impresión UV (cuadrado o rectangular)","geometria":"lamina","medidas":{"m1":40,"m2":30},"medidaEstandar":false,"material":{"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Negro","espesorMm":3},"opciones":[{"clase":"personalizacion","nombre":"Impresión UV a color","extra":20}],"texto":"Baños","notas":null,"areaUnidadM2":0.12,"areaManual":false,"mermaPct":15,"materiales":[{"productoId":24,"codigo":"F7E029","nombre":"ACRILICO ECO COLORES NEGRO 3MM 1.22X1.83","unidad":"plancha","cantidad":0.25,"precio":147,"esPlancha":true},{"productoId":292,"codigo":"ACC033","nombre":"SOPORTES DE ACRILICO 19MM X 30MM CRISTAL","unidad":"Unidades","cantidad":16,"precio":6,"esPlancha":false}],"costoMaterial":132.75,"factor":2,"precioSugerido":66.38,"precioUnitario":110,"reservar":false,"corte":null}'::jsonb, '{material,grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Colores' and detalle = 'Negro' and espesor_mm = 3))),
   null, null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 292, 'SOPORTES DE ACRILICO 19MM X 30MM CRISTAL', 'ACC033', null,
   8::numeric, 6::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado, observaciones_envio
) values (
  (select id from seed_pedidos where clave = 'registrado-provincia'), (select id from public.departamentos where nombre = 'Piura'),
  (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id where d.nombre = 'Piura' and pr.nombre = 'Piura'),
  'Shalom — Piura Centro', 'Carlos Zapata Ruiz', 'DNI', '40123987', '969 220 145', 45, false, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'registrado-provincia'), 287.92, 'transferencia', ((current_date + -1) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'registrado-provincia'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + -1) + time '09:15') at time zone 'America/Lima');

-- registrado-tienda: registrado, SEED María Torres Huamán
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED María Torres Huamán', '988 112 233', array['SP']::public.tipo_pedido[], null, 22,
    'contado', null, 446.04, 'tienda', null, 'tienda',
    'registrado', null, (current_date + 2), ((current_date + 0) + time '09:15') at time zone 'America/Lima',
    null, null,
    '2 × [F7E024] ACRILICO ECO CRISTAL 3MM 1.22X1.83 — Corte a 60x40 cm
8 × [ACC032] SOPORTES DE ACRILICO 25MM X 40MM CRISTAL
12 × [ACC001] TORNILLOS 6MM CRISTAL', null, null, null, null, (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'registrado-tienda', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'registrado-tienda'), 6, 'SEED María Torres Huamán', '41234567', '988 112 233',
    9012, 'S09012', 'sincronizada', 378, 68.04, 446.04,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + 0) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'producto'::public.tipo_linea, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', 'Corte a 60x40 cm',
   2::numeric, 147::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 291, 'SOPORTES DE ACRILICO 25MM X 40MM CRISTAL', 'ACC032', null,
   8::numeric, 6::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric),
  (3::smallint, 'producto'::public.tipo_linea, 277, 'TORNILLOS 6MM CRISTAL', 'ACC001', null,
   12::numeric, 3::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from seed_pedidos where clave = 'registrado-tienda'), 446.04, 'efectivo', ((current_date + 0) + time '10:30') at time zone 'America/Lima', (select id from public.usuarios where usuario = 'ana'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'registrado-tienda'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + 0) + time '09:15') at time zone 'America/Lima');

-- registrado-taller: registrado, SEED Publicidad Lima SAC
with nuevo as (
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
    tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega, ubicacion_actual,
    estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
    detalle, observaciones, notas_entrega, numero_comprobante, responsable_id, creado_por
  ) values (
    false, 'SEED Publicidad Lima SAC', '01 444 5566', array['CL', 'SP']::public.tipo_pedido[], null, 50,
    'credito', 30, 764.64, 'domicilio', 'Jr. Camaná 780, Cercado de Lima', 'taller',
    'registrado', null, (current_date + 4), ((current_date + 0) + time '09:15') at time zone 'America/Lima',
    null, null,
    'Corte láser · Acrílico ECO · Cristal · 3 mm: 10 piezas (10 × 60×80 cm) — 3 planchas de 122×183
  ↳ Pegar los separadores después de cortar.
40 × [ACC033] SOPORTES DE ACRILICO 19MM X 30MM CRISTAL', null, 'Entregar en recepción, de 9 a 13 h.', null, null, (select id from public.usuarios where usuario = 'ana')
  )
  returning id, codigo
)
insert into seed_pedidos (clave, id, codigo) select 'registrado-taller', id, codigo from nuevo;

with c as (
  insert into public.cotizaciones (
    pedido_id, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion, monto_sin_impuestos, monto_impuestos, monto_total,
    confirmada_en_odoo, stock_descontado, creado_por, creado_en
  ) values (
    (select id from seed_pedidos where clave = 'registrado-taller'), 5, 'SEED Publicidad Lima SAC', '20512345671', '01 444 5566',
    9013, 'S09013', 'sincronizada', 648, 116.64, 764.64,
    true, false, (select id from public.usuarios where usuario = 'ana'), ((current_date + 0) + time '09:00') at time zone 'America/Lima'
  )
  returning id
)
insert into public.cotizacion_productos (
  cotizacion_id, posicion, tipo, odoo_product_id, producto_nombre, producto_codigo, descripcion,
  cantidad, precio_unitario, importe, corte, terminado, indicaciones, planchas_usadas
)
select c.id, l.* from c, (values
  (1::smallint, 'corte'::public.tipo_linea, 20, 'ACRILICO ECO CRISTAL 3MM 1.22X1.83', 'F7E024', 'Corte láser · Acrílico ECO · Cristal · 3 mm: 10 × 60×80 cm',
   3::numeric, 127.4::numeric, 408::numeric,
   jsonb_set('{"version":1,"grupoId":"__GRUPO__","material":"Acrílico ECO","color":"Cristal","espesorMm":3,"modalidad":"laser","rotable":true,"piezas":[{"ancho":60,"alto":80,"cantidad":10}],"servicio":{"productoId":31,"codigo":"SRV002","nombre":"SERVICIO DE CORTE LASER"},"sobrantes":false,"formato":{"codigo":"F7E024","ancho":122,"alto":183,"precio":147},"planchas":[{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":86,"piezas":4,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":60,"y2":80,"libre":false,"piezaId":"f1#1","rotada":false},{"x1":60,"y1":0,"x2":120,"y2":80,"libre":false,"piezaId":"f1#2","rotada":false},{"x1":120,"y1":0,"x2":122,"y2":80,"libre":true},{"x1":0,"y1":80,"x2":60,"y2":160,"libre":false,"piezaId":"f1#3","rotada":false},{"x1":60,"y1":80,"x2":120,"y2":160,"libre":false,"piezaId":"f1#4","rotada":false},{"x1":120,"y1":80,"x2":122,"y2":160,"libre":true},{"x1":0,"y1":160,"x2":122,"y2":183,"libre":true}]},{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":86,"piezas":4,"cobro":{"nombre":"1","factor":1,"ancho":122,"alto":183,"monto":147,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":60,"y2":80,"libre":false,"piezaId":"f1#5","rotada":false},{"x1":60,"y1":0,"x2":120,"y2":80,"libre":false,"piezaId":"f1#6","rotada":false},{"x1":120,"y1":0,"x2":122,"y2":80,"libre":true},{"x1":0,"y1":80,"x2":60,"y2":160,"libre":false,"piezaId":"f1#7","rotada":false},{"x1":60,"y1":80,"x2":120,"y2":160,"libre":false,"piezaId":"f1#8","rotada":false},{"x1":120,"y1":80,"x2":122,"y2":160,"libre":true},{"x1":0,"y1":160,"x2":122,"y2":183,"libre":true}]},{"origen":{"tipo":"plancha"},"ancho":122,"alto":183,"usoPct":43,"piezas":2,"cobro":{"nombre":"1/2","factor":0.5,"ancho":61,"alto":183,"monto":88.2,"nota":null},"paneles":[{"x1":0,"y1":0,"x2":60,"y2":80,"libre":false,"piezaId":"f1#9","rotada":false},{"x1":60,"y1":0,"x2":61,"y2":183,"libre":true},{"x1":0,"y1":80,"x2":60,"y2":160,"libre":false,"piezaId":"f1#10","rotada":false},{"x1":0,"y1":160,"x2":60,"y2":183,"libre":true},{"x1":61,"y1":0,"x2":122,"y2":183,"libre":true,"sobrante":true}]}],"montoMaterial":382.2,"montoServicio":25.8,"total":408,"minutosLaser":26.36,"desglose":[{"etiqueta":"Plancha 1: completa (122×183)","monto":147},{"etiqueta":"Plancha 2: completa (122×183)","monto":147},{"etiqueta":"Plancha 3: las piezas caben en 1/2 (61×183) → S/ 147.00 × 1/2 + 20 %","monto":88.2},{"etiqueta":"Corte láser: 10 piezas, 26.36 min","monto":25.8},{"etiqueta":"Total","monto":408,"esTotal":true}]}'::jsonb, '{grupoId}', to_jsonb((select id::text from public.grupos_plancha where material = 'Acrílico ECO' and variante = 'Cristal' and detalle = '' and espesor_mm = 3))),
   null::jsonb,
   'Pegar los separadores después de cortar.', null::numeric),
  (2::smallint, 'producto'::public.tipo_linea, 292, 'SOPORTES DE ACRILICO 19MM X 30MM CRISTAL', 'ACC033', null,
   40::numeric, 6::numeric, null::numeric,
   null::jsonb,
   null::jsonb,
   null, null::numeric)
) as l;

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from seed_pedidos where clave = 'registrado-taller'), 'registrado', 'administracion', null, (select id from public.usuarios where usuario = 'ana'), ((current_date + 0) + time '09:15') at time zone 'America/Lima');

alter table public.pedidos          enable trigger pedidos_auditoria;
alter table public.pedidos          enable trigger pedidos_historial;
alter table public.envios_provincia enable trigger envios_provincia_auditoria;
alter table public.adjuntos         enable trigger adjuntos_auditoria;

-- Lo que el seed promete: cada pedido con su cotización y sus líneas, y el monto
-- pagado igual a la suma de los abonos (lo mantiene el trigger de `pagos`).
do $$
declare
  sin_lineas integer;
  descuadre  integer;
begin
  select count(*) into sin_lineas
  from seed_pedidos s
  where not exists (
    select 1 from public.cotizaciones c join public.cotizacion_productos cp on cp.cotizacion_id = c.id
    where c.pedido_id = s.id
  );
  if sin_lineas > 0 then
    raise exception 'El seed dejó % pedidos sin líneas', sin_lineas;
  end if;

  select count(*) into descuadre
  from public.pedidos p
  where p.monto_pagado <> coalesce((select sum(g.monto) from public.pagos g where g.pedido_id = p.id), 0);
  if descuadre > 0 then
    raise exception 'El seed dejó % pedidos con el monto pagado descuadrado', descuadre;
  end if;
end $$;

drop table seed_pedidos;

-- Clave que comparte el servidor de Next con `email_de_usuario` (LOGIN_SECRET).
-- Solo para desarrollo local: en el proyecto alojado se inserta a mano con otro valor.
insert into public.secretos_app (nombre, valor)
values ('login', 'plexi-login-dev-secreto')
on conflict (nombre) do nothing;
