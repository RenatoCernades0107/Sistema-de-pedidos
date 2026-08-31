-- Seed de desarrollo de Plexiacril. GENERADO desde web/lib/datos.ts
-- (scripts/gen-seed.cjs). Si cambian los datos del prototipo, se regenera; no se
-- edita a mano.
--
-- Trae los tres usuarios de prueba, uno por rol, y los 23 pedidos del prototipo,
-- que ya cubren los siete estados, envíos a provincia, crédito, pedidos con varios
-- tipos y pedidos anulados y observados.
--
-- Contraseña de los tres: plexi2026. Es un entorno de desarrollo; antes de que
-- entren datos reales hay que cambiarlas.

-- pgcrypto vive en el esquema extensions en Supabase, que no está en el search_path
-- de la sesión que ejecuta el seed: hay que habilitarlo y llamarlo con nombre completo.
create extension if not exists pgcrypto with schema extensions;

-- La carga no es la edición de nadie: sin esto, la auditoría arranca con cientos
-- de filas de ruido y el historial pierde las fechas reales del prototipo.
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
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('nombre', 'Ana Torres', 'usuario', 'ana', 'rol', 'administracion'),
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
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('nombre', 'Carla Díaz', 'usuario', 'carla', 'rol', 'logistica'),
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
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('nombre', 'Miguel Ruiz', 'usuario', 'miguel', 'rol', 'operaciones'),
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

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCL_2026_H4TP', false, 'Corporación Andina SAC', '981 342 705',
  array['CL']::public.tipo_pedido[], null,
  12, 'a_cuenta', null, 1250,
  'tienda', null,
  'taller', 'en_proceso', null,
  '2026-08-30', '2026-08-24 09:00:00-05', null, null,
  '12 placas 60x40 en acrílico transparente 3mm, grabado del logo al centro.', null, null,
  (select id from public.trabajadores where nombre = 'Angel'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_H4TP'), 600, 'efectivo', '2026-08-24 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_H4TP'), 'diseno', 'pedidos/LCL_2026_H4TP/diseno/plano-corte-v2.pdf',
        'plano-corte-v2.pdf', 'application/pdf', 860160, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_H4TP'), 'diseno', 'pedidos/LCL_2026_H4TP/diseno/referencia-cliente.jpg',
        'referencia-cliente.jpg', 'image/jpeg', 1258291, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_H4TP'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-24T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_H4TP'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-24T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LPT_2026_K9ZM', false, 'Botica Salud Norte', '944 618 230',
  array['PT']::public.tipo_pedido[], 'displays',
  4, 'contado', null, 890,
  'tienda', null,
  'tienda', 'listo', null,
  '2026-08-29', '2026-08-20 09:00:00-05', null, null,
  '4 displays de mostrador, 3 niveles, acrílico blanco 4mm.', null, null,
  (select id from public.trabajadores where nombre = 'Issac'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_K9ZM'), 890, 'transferencia', '2026-08-20 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_K9ZM'), 'diseno', 'pedidos/LPT_2026_K9ZM/diseno/plano-display.pdf',
        'plano-display.pdf', 'application/pdf', 634880, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_K9ZM'), 'diseno', 'pedidos/LPT_2026_K9ZM/diseno/referencia-cliente.jpg',
        'referencia-cliente.jpg', 'image/jpeg', 1153434, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_K9ZM'), 'foto_entrega', 'pedidos/LPT_2026_K9ZM/foto_entrega/producto-terminado.jpg',
        'producto-terminado.jpg', 'image/jpeg', 2202010, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_K9ZM'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-20T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_K9ZM'), 'listo', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-20T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'PCM_2026_R2WQ', true, 'Distribuidora Chan Chan EIRL', '962 507 481',
  array['CM']::public.tipo_pedido[], null,
  30, 'a_cuenta', null, 2340,
  'agencia', null,
  'agencia', 'en_transito', null,
  '2026-09-02', '2026-08-18 09:00:00-05', null, null,
  'Corte manual de 30 planchas 1.20x0.80, bordes pulidos.', null, 'F001-004512',
  (select id from public.trabajadores where nombre = 'Juan'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  (select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), (select id from public.departamentos where nombre = 'La Libertad'), (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = 'La Libertad' and pr.nombre = 'Trujillo'),
  'Shalom - Trujillo Centro', 'Marisol Vega Ríos', 'DNI', '44821903',
  '958 447 210', 120, true, 'Avisar a la persona que recoge una hora antes de la llegada.'
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 1000, 'transferencia', '2026-08-18 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 170, 'yape_plin', '2026-08-25 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'diseno', 'pedidos/PCM_2026_R2WQ/diseno/plano-corte-v2.pdf',
        'plano-corte-v2.pdf', 'application/pdf', 860160, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'diseno', 'pedidos/PCM_2026_R2WQ/diseno/referencia-cliente.jpg',
        'referencia-cliente.jpg', 'image/jpeg', 1258291, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'factura', 'pedidos/PCM_2026_R2WQ/factura/factura-F001-004512.pdf',
        'factura-F001-004512.pdf', 'application/pdf', 215040, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'guia', 'pedidos/PCM_2026_R2WQ/guia/guia-remision.pdf',
        'guia-remision.pdf', 'application/pdf', 184320, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-18T09:14:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'en_proceso', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-19T08:02:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'listo', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-26T17:41:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), 'en_transito', 'logistica', null, (select id from public.usuarios where email = 'carla@plexiacril.test'), '2026-08-28T11:20:00-05');

insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), (select id from public.usuarios where email = 'carla@plexiacril.test'), 'ubicacion_actual', 'En taller', 'En agencia', '2026-08-28T11:20:00-05');

insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), (select id from public.usuarios where email = 'carla@plexiacril.test'), 'estado', 'Listo', 'En tránsito', '2026-08-28T11:20:00-05');

insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), (select id from public.usuarios where email = 'ana@plexiacril.test'), 'numero_factura', '—', 'F001-004512', '2026-08-28T10:57:00-05');

insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), (select id from public.usuarios where email = 'miguel@plexiacril.test'), 'estado', 'En proceso', 'Listo', '2026-08-26T17:41:00-05');

insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo, creado_en)
values ((select id from public.pedidos where codigo = 'PCM_2026_R2WQ'), (select id from public.usuarios where email = 'ana@plexiacril.test'), 'monto_total', '2 100.00', '2 340.00', '2026-08-21T15:03:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LSP_2026_T7YX', false, 'Universidad Nacional de Ingeniería', '918 264 933',
  array['SP']::public.tipo_pedido[], null,
  20, 'credito', 30, 4100,
  'taller', null,
  'taller', 'registrado', null,
  '2026-09-04', '2026-08-28 09:00:00-05', null, null,
  '20 planchas acrílico cristal 2440x1220x5mm, sin cortar.', null, null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LSP_2026_T7YX'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-28T08:30:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'PPT_2026_M3NP', true, 'Clínica San Pablo - Arequipa', '973 155 620',
  array['PT']::public.tipo_pedido[], 'letreros',
  6, 'a_cuenta', null, 3680,
  'agencia', null,
  'taller', 'en_proceso', null,
  '2026-08-27', '2026-08-14 09:00:00-05', null, null,
  '6 letreros de señalización interna, acrílico azul 5mm con vinil blanco.', null, null,
  (select id from public.trabajadores where nombre = 'Clever'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  (select id from public.pedidos where codigo = 'PPT_2026_M3NP'), (select id from public.departamentos where nombre = 'Arequipa'), (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = 'Arequipa' and pr.nombre = 'Arequipa'),
  'Olva Courier - Cercado', 'Jorge Cáceres Núñez', 'DNI', '29874102',
  '954 118 302', 180, false, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PPT_2026_M3NP'), 1840, 'transferencia', '2026-08-14 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PPT_2026_M3NP'), 'diseno', 'pedidos/PPT_2026_M3NP/diseno/senaletica-v3.pdf',
        'senaletica-v3.pdf', 'application/pdf', 1468006, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PPT_2026_M3NP'), 'diseno', 'pedidos/PPT_2026_M3NP/diseno/vinil-blanco.ai',
        'vinil-blanco.ai', 'application/postscript', 798720, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PPT_2026_M3NP'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-14T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PPT_2026_M3NP'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-14T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCL_2026_B8FD', false, 'Restaurante El Tumi', null,
  array['CL']::public.tipo_pedido[], null,
  25, 'contado', null, 640,
  'tienda', null,
  'tienda', 'entregado', null,
  '2026-08-22', '2026-08-15 09:00:00-05', '2026-08-22', null,
  '25 porta cartas cortados a láser, acrílico ámbar 3mm.', null, 'F001-004489',
  (select id from public.trabajadores where nombre = 'Jhon'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_B8FD'), 640, 'efectivo', '2026-08-15 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_B8FD'), 'diseno', 'pedidos/LCL_2026_B8FD/diseno/porta-cartas.pdf',
        'porta-cartas.pdf', 'application/pdf', 532480, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_B8FD'), 'factura', 'pedidos/LCL_2026_B8FD/factura/factura-F001-004489.pdf',
        'factura-F001-004489.pdf', 'application/pdf', 202752, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_B8FD'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-15T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_B8FD'), 'entregado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-15T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCM_2026_W5QA', false, 'Gimnasio Bodytech Miraflores', '956 890 174',
  array['CM']::public.tipo_pedido[], null,
  8, 'a_cuenta', null, 1480,
  'domicilio', 'Av. Benavides 1944, Miraflores',
  'taller', 'observado', 'El cliente no confirma la medida de altura; producción detenida desde el 26/08.',
  '2026-08-28', '2026-08-21 09:00:00-05', null, null,
  'Separadores de vestuario. FALTA que el cliente confirme la altura final.', null, null,
  (select id from public.trabajadores where nombre = 'Angel'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LCM_2026_W5QA'), 400, 'yape_plin', '2026-08-21 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCM_2026_W5QA'), 'diseno', 'pedidos/LCM_2026_W5QA/diseno/separadores-v1.pdf',
        'separadores-v1.pdf', 'application/pdf', 931840, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_W5QA'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-21T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_W5QA'), 'observado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-21T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'PCL_2026_J2VH', true, 'Municipalidad de Huancayo', '949 302 668',
  array['CL']::public.tipo_pedido[], null,
  40, 'a_cuenta', null, 5250,
  'agencia', null,
  'taller', 'listo', null,
  '2026-08-31', '2026-08-19 09:00:00-05', null, null,
  '40 placas conmemorativas grabadas a láser, acrílico bronce 4mm.', null, null,
  (select id from public.trabajadores where nombre = 'Juan'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  (select id from public.pedidos where codigo = 'PCL_2026_J2VH'), (select id from public.departamentos where nombre = 'Junín'), (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = 'Junín' and pr.nombre = 'Huancayo'),
  'Transportes Molina', 'Elsa Quispe Ramos', 'DNI', '20114588',
  '964 220 118', 260, false, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_J2VH'), 2625, 'transferencia', '2026-08-19 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_J2VH'), 'diseno', 'pedidos/PCL_2026_J2VH/diseno/placa-conmemorativa.pdf',
        'placa-conmemorativa.pdf', 'application/pdf', 1153434, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_J2VH'), 'diseno', 'pedidos/PCL_2026_J2VH/diseno/escudo-municipal.svg',
        'escudo-municipal.svg', 'application/octet-stream', 98304, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCL_2026_J2VH'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-19T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCL_2026_J2VH'), 'listo', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-19T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LPT_2026_N6XC', false, 'Óptica Visión Lima', '967 471 052',
  array['PT']::public.tipo_pedido[], 'porta_afiches',
  10, 'credito', 15, 720,
  'tienda', null,
  'taller', 'en_proceso', null,
  '2026-09-01', '2026-08-25 09:00:00-05', null, null,
  '10 porta afiches A3 vertical de pared, cristal 3mm.', null, null,
  (select id from public.trabajadores where nombre = 'Issac'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_N6XC'), 'diseno', 'pedidos/LPT_2026_N6XC/diseno/porta-afiche-a3.pdf',
        'porta-afiche-a3.pdf', 'application/pdf', 450560, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_N6XC'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-25T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_N6XC'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-25T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCL_2026_D9KR', false, 'Colegio Los Álamos', '921 736 480',
  array['CL']::public.tipo_pedido[], null,
  60, 'a_cuenta', null, 1980,
  'taller', null,
  'taller', 'registrado', null,
  '2026-09-05', '2026-08-28 09:00:00-05', null, null,
  'Set de 60 medallas cortadas a láser con nombre grabado.', null, null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_D9KR'), 990, 'efectivo', '2026-08-28 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_D9KR'), 'diseno', 'pedidos/LCL_2026_D9KR/diseno/medallas-nombres.xlsx',
        'medallas-nombres.xlsx', 'application/octet-stream', 49152, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_D9KR'), 'diseno', 'pedidos/LCL_2026_D9KR/diseno/troquel-medalla.pdf',
        'troquel-medalla.pdf', 'application/pdf', 317440, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_D9KR'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-28T08:30:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'PSP_2026_G3LM', true, 'Ferretería El Sol - Piura', '988 204 619',
  array['SP']::public.tipo_pedido[], null,
  30, 'contado', null, 6300,
  'agencia', null,
  'agencia', 'entregado', null,
  '2026-08-20', '2026-08-08 09:00:00-05', '2026-08-20', null,
  '30 planchas de acrílico blanco 3mm.', null, 'F001-004470',
  (select id from public.trabajadores where nombre = 'Clever'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  (select id from public.pedidos where codigo = 'PSP_2026_G3LM'), (select id from public.departamentos where nombre = 'Piura'), (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = 'Piura' and pr.nombre = 'Piura'),
  'Shalom - Piura', 'Luis Farfán Castro', 'DNI', '03887219',
  '969 553 017', 340, true, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PSP_2026_G3LM'), 6300, 'transferencia', '2026-08-08 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PSP_2026_G3LM'), 'factura', 'pedidos/PSP_2026_G3LM/factura/factura-F001-004470.pdf',
        'factura-F001-004470.pdf', 'application/pdf', 209920, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PSP_2026_G3LM'), 'guia', 'pedidos/PSP_2026_G3LM/guia/guia-remision-piura.pdf',
        'guia-remision-piura.pdf', 'application/pdf', 180224, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PSP_2026_G3LM'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-08T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PSP_2026_G3LM'), 'entregado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-08T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LPT_2026_Z4BT', false, 'Cevichería La Mar del Sur', '935 617 902',
  array['PT']::public.tipo_pedido[], 'cajas',
  15, 'a_cuenta', null, 1120,
  'tienda', null,
  'tienda', 'listo', null,
  '2026-08-29', '2026-08-22 09:00:00-05', null, null,
  '15 cajas porta cubiertos con tapa, cristal 3mm.', null, null,
  (select id from public.trabajadores where nombre = 'Jhon'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_Z4BT'), 560, 'efectivo', '2026-08-22 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_Z4BT'), 'diseno', 'pedidos/LPT_2026_Z4BT/diseno/caja-cubiertos.pdf',
        'caja-cubiertos.pdf', 'application/pdf', 389120, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_Z4BT'), 'foto_entrega', 'pedidos/LPT_2026_Z4BT/foto_entrega/muestra-aprobada.jpg',
        'muestra-aprobada.jpg', 'image/jpeg', 1887437, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_Z4BT'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-22T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_Z4BT'), 'listo', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-22T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCM_2026_Q7SE', false, 'Estudio Contable Paredes', '974 083 251',
  array['CM']::public.tipo_pedido[], null,
  6, 'contado', null, 430,
  'tienda', null,
  'taller', 'anulado', 'Cliente canceló el pedido el 23/08 por cambio de proveedor.',
  '2026-08-26', '2026-08-17 09:00:00-05', null, '2026-08-23',
  'Porta tarjetas de escritorio.', null, null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_Q7SE'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-17T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_Q7SE'), 'anulado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-17T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'PCL_2026_V8HN', true, 'Hotel Casa Andina - Cusco', '913 590 447',
  array['CL']::public.tipo_pedido[], null,
  48, 'a_cuenta', null, 2870,
  'agencia', null,
  'taller', 'registrado', null,
  '2026-09-08', '2026-08-27 09:00:00-05', null, null,
  'Señalética de habitaciones, 48 piezas grabadas a láser.', null, null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  (select id from public.pedidos where codigo = 'PCL_2026_V8HN'), (select id from public.departamentos where nombre = 'Cusco'), (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = 'Cusco' and pr.nombre = 'Cusco'),
  null, null, 'DNI', null,
  null, 0, false, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_V8HN'), 1000, 'transferencia', '2026-08-27 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_V8HN'), 'diseno', 'pedidos/PCL_2026_V8HN/diseno/numeracion-habitaciones.pdf',
        'numeracion-habitaciones.pdf', 'application/pdf', 675840, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCL_2026_V8HN'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-27T08:30:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LPT_2026_C2RJ', false, 'Farmacia Vida Sana', null,
  array['PT']::public.tipo_pedido[], 'pivotante',
  2, 'a_cuenta', null, 1560,
  'domicilio', 'Jr. Huánuco 455, Cercado de Lima',
  'taller', 'en_proceso', null,
  '2026-08-31', '2026-08-26 09:00:00-05', null, null,
  '2 exhibidores pivotantes de piso, 5 caras.', null, null,
  (select id from public.trabajadores where nombre = 'Angel'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_C2RJ'), 780, 'yape_plin', '2026-08-26 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_C2RJ'), 'diseno', 'pedidos/LPT_2026_C2RJ/diseno/pivotante-5-caras.pdf',
        'pivotante-5-caras.pdf', 'application/pdf', 1363149, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_C2RJ'), 'diseno', 'pedidos/LPT_2026_C2RJ/diseno/render-cliente.png',
        'render-cliente.png', 'image/png', 2516582, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_C2RJ'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-26T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_C2RJ'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-26T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCL_2026_F5PW', false, 'Banco Pichincha - Ag. San Isidro', '968 725 130',
  array['CL']::public.tipo_pedido[], null,
  8, 'contado', null, 2240,
  'tienda', null,
  'tienda', 'entregado', null,
  '2026-08-25', '2026-08-13 09:00:00-05', '2026-08-25', null,
  'Mamparas divisorias de ventanilla, 8 unidades.', null, 'F001-004501',
  (select id from public.trabajadores where nombre = 'Juan'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_F5PW'), 2240, 'transferencia', '2026-08-13 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_F5PW'), 'diseno', 'pedidos/LCL_2026_F5PW/diseno/mampara-ventanilla.pdf',
        'mampara-ventanilla.pdf', 'application/pdf', 757760, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_F5PW'), 'foto_entrega', 'pedidos/LCL_2026_F5PW/foto_entrega/instalacion-final.jpg',
        'instalacion-final.jpg', 'image/jpeg', 2726298, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_F5PW'), 'factura', 'pedidos/LCL_2026_F5PW/factura/factura-F001-004501.pdf',
        'factura-F001-004501.pdf', 'application/pdf', 217088, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_F5PW'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-13T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_F5PW'), 'entregado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-13T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LMX_2026_A7KD', false, 'Cafetería Bisetti', '942 318 906',
  array['CL', 'AC']::public.tipo_pedido[], null,
  18, 'a_cuenta', null, 2150,
  'tienda', null,
  'taller', 'en_proceso', null,
  '2026-09-03', '2026-08-27 09:00:00-05', null, null,
  '12 posavasos grabados y 6 soportes de menú con bisagra de aluminio.', 'El cliente pasa a revisar la muestra el lunes por la mañana.', null,
  (select id from public.trabajadores where nombre = 'Issac'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LMX_2026_A7KD'), 900, 'yape_plin', '2026-08-27 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LMX_2026_A7KD'), 'diseno', 'pedidos/LMX_2026_A7KD/diseno/posavasos-logo.pdf',
        'posavasos-logo.pdf', 'application/pdf', 419840, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LMX_2026_A7KD'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-27T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LMX_2026_A7KD'), 'en_proceso', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-27T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LSP_2026_H2QN', false, 'Vidriería Santa Rosa', '957 604 283',
  array['SP']::public.tipo_pedido[], null,
  2.5, 'contado', null, 780,
  'taller', null,
  'tienda', 'registrado', null,
  '2026-09-01', '2026-08-29 09:00:00-05', null, null,
  '2.5 Acrílico Alfa 5mm transparente F7', 'Media plancha se corta del retazo de la semana pasada.', null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LSP_2026_H2QN'), 780, 'efectivo', '2026-08-29 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LSP_2026_H2QN'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-29T08:30:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCL_2026_Y3MB', false, 'Panadería San Jorge', '929 861 375',
  array['CL']::public.tipo_pedido[], null,
  30, 'contado', null, 510,
  'tienda', null,
  'tienda', 'entregado', null,
  '2026-08-29', '2026-08-24 09:00:00-05', '2026-08-29', null,
  '30 porta precios de mostrador, cristal 2mm.', null, 'F001-004520',
  (select id from public.trabajadores where nombre = 'Jhon'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_Y3MB'), 510, 'efectivo', '2026-08-24 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LCL_2026_Y3MB'), 'factura', 'pedidos/LCL_2026_Y3MB/factura/factura-F001-004520.pdf',
        'factura-F001-004520.pdf', 'application/pdf', 198656, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_Y3MB'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-24T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCL_2026_Y3MB'), 'entregado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-24T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCM_2026_X9TR', false, 'Boutique Almendra', '983 240 517',
  array['CM']::public.tipo_pedido[], null,
  4, 'contado', null, 690,
  'tienda', null,
  'taller', 'anulado', 'El cliente canceló hoy: la tienda no abre en la fecha prevista.',
  '2026-09-06', '2026-08-26 09:00:00-05', null, '2026-08-29',
  '4 exhibidores de vitrina, acrílico blanco 3mm.', null, null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_X9TR'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-08-26T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_X9TR'), 'anulado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-08-26T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'PCL_2026_L4WD', true, 'Municipalidad de Tarapoto', '916 452 738',
  array['CL']::public.tipo_pedido[], null,
  55, 'a_cuenta', null, 7420,
  'agencia', null,
  'agencia', 'entregado', null,
  '2026-07-20', '2026-07-06 09:00:00-05', '2026-07-18', null,
  '55 placas de señalización institucional grabadas a láser.', null, 'F001-004312',
  (select id from public.trabajadores where nombre = 'Juan'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  (select id from public.pedidos where codigo = 'PCL_2026_L4WD'), (select id from public.departamentos where nombre = 'San Martín'), (select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = 'San Martín' and pr.nombre = 'San Martín'),
  'Shalom - Tarapoto', 'Rocío Panduro Silva', 'DNI', '01128744',
  '942 771 306', 410, true, null
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_L4WD'), 3710, 'transferencia', '2026-07-06 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_L4WD'), 3710, 'transferencia', '2026-07-18 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'PCL_2026_L4WD'), 'factura', 'pedidos/PCL_2026_L4WD/factura/factura-F001-004312.pdf',
        'factura-F001-004312.pdf', 'application/pdf', 205824, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCL_2026_L4WD'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-07-06T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'PCL_2026_L4WD'), 'entregado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-07-06T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LPT_2026_S6VK', false, 'Hostal Miraflores Suites', '961 073 894',
  array['PT']::public.tipo_pedido[], 'letreros',
  22, 'contado', null, 1890,
  'tienda', null,
  'tienda', 'entregado', null,
  '2026-08-01', '2026-07-21 09:00:00-05', '2026-07-30', null,
  '22 letreros de puerta con numeración, acrílico negro 4mm.', null, 'F001-004355',
  (select id from public.trabajadores where nombre = 'Angel'), (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_S6VK'), 1890, 'tarjeta', '2026-07-21 12:00:00-05', (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_S6VK'), 'factura', 'pedidos/LPT_2026_S6VK/factura/factura-F001-004355.pdf',
        'factura-F001-004355.pdf', 'application/pdf', 192512, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values ((select id from public.pedidos where codigo = 'LPT_2026_S6VK'), 'foto_entrega', 'pedidos/LPT_2026_S6VK/foto_entrega/letreros-instalados.jpg',
        'letreros-instalados.jpg', 'image/jpeg', 2306867, (select id from public.usuarios where email = 'ana@plexiacril.test'));

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_S6VK'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-07-21T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LPT_2026_S6VK'), 'entregado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-07-21T16:05:00-05');

insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  'LCM_2026_B3ZQ', false, 'Imprenta Del Valle', '937 528 160',
  array['CM', 'AC']::public.tipo_pedido[], null,
  12, 'a_cuenta', null, 1340,
  'tienda', null,
  'taller', 'anulado', 'Se anuló el 24/07: el material llegó rayado y el cliente prefirió no reprogramar.',
  '2026-07-29', '2026-07-15 09:00:00-05', null, '2026-07-24',
  '12 bandejas apilables con topes de aluminio.', 'El adelanto se devolvió en efectivo el mismo día.', null,
  null, (select id from public.usuarios where email = 'ana@plexiacril.test')
);

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_B3ZQ'), 'registrado', 'administracion', null, (select id from public.usuarios where email = 'ana@plexiacril.test'), '2026-07-15T08:30:00-05');

insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values ((select id from public.pedidos where codigo = 'LCM_2026_B3ZQ'), 'anulado', 'operaciones', null, (select id from public.usuarios where email = 'miguel@plexiacril.test'), '2026-07-15T16:05:00-05');

alter table public.pedidos          enable trigger pedidos_auditoria;
alter table public.pedidos          enable trigger pedidos_historial;
alter table public.envios_provincia enable trigger envios_provincia_auditoria;
alter table public.adjuntos         enable trigger adjuntos_auditoria;

-- El trigger de `pagos` ya dejó `monto_pagado` al día; esto solo confirma que la
-- suma de abonos coincide con lo que traía el prototipo.
do $$
declare descuadre integer;
begin
  select count(*) into descuadre
  from public.pedidos p
  where p.monto_pagado <> coalesce((select sum(g.monto) from public.pagos g where g.pedido_id = p.id), 0);

  if descuadre > 0 then
    raise exception 'El seed dejó % pedidos con el monto pagado descuadrado', descuadre;
  end if;
end $$;
