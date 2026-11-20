-- Verificación de la migración 20261129000200 (las búsquedas de las referencias @).
--
--   npx supabase db query --linked -f supabase/tests/chat_referencias.sql
--
-- Crea tres personas (una por rol), dos pedidos de un mismo cliente escrito de
-- dos formas y una cotización que ata uno de ellos a un partner de Odoo, todo
-- dentro de una transacción que termina en ROLLBACK.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.pedidos_de_cliente(integer, text, text)', 'execute')
     or has_function_privilege('anon', 'public.buscar_pedidos_chat(text)', 'execute')
     or has_function_privilege('anon', 'public.clientes_de_pedidos(text)', 'execute') then
    raise exception 'FALLO: anon puede buscar pedidos o clientes';
  end if;
  if not has_function_privilege('authenticated', 'public.pedidos_de_cliente(integer, text, text)', 'execute') then
    raise exception 'FALLO: una sesión no puede pedir los pedidos de un cliente';
  end if;
  if public.chat_normalizar('Pérez ÑAÑEZ') <> 'perez nanez' then
    raise exception 'FALLO: chat_normalizar no quita tildes';
  end if;
  if public.chat_compactar('P2611-001') <> 'p2611001' then
    raise exception 'FALLO: chat_compactar';
  end if;
  if public.chat_telefono('+51 981 342 705') <> public.chat_telefono('981342705') then
    raise exception 'FALLO: chat_telefono no iguala el prefijo del país';
  end if;
end $$;

-- ── 2. Datos de prueba ──────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000d4a1', 'ref-admin@prueba.test',
   '{"nombre":"Admin Ref","usuario":"ref-admin"}',
   '{"rol":"administracion"}'),
  ('00000000-0000-4000-8000-00000000d4a2', 'ref-logi@prueba.test',
   '{"nombre":"Logi Ref","usuario":"ref-logi"}',
   '{"rol":"logistica"}'),
  ('00000000-0000-4000-8000-00000000d4a3', 'ref-ope@prueba.test',
   '{"nombre":"Ope Ref","usuario":"ref-ope"}',
   '{"rol":"operaciones"}');

-- Los pedidos se copian de uno del seed para no repetir todas sus columnas.
insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, fecha_prometida, fecha_creacion, detalle)
select v.codigo, false, v.nombre, v.telefono, p.tipos_pedido, p.tipo_producto_terminado,
       p.cantidad, p.tipo_pago, p.plazo_credito_dias, 500, p.lugar_entrega, p.direccion_entrega,
       'taller', 'registrado', current_date + 7, v.creado, 'prueba de referencias'
  from (select * from public.pedidos order by codigo limit 1) p,
       (values ('P9911-001', 'Juan Pérez', '981 000 111', now() - interval '2 day'),
               ('P9911-002', 'JUAN PEREZ ', null, now() - interval '1 day'),
               ('P9911-003', 'Otra Persona', '+51 981000111', now()),
               ('P9911-004', 'Nadie Más', '900 000 000', now())) as v(codigo, nombre, telefono, creado);

insert into public.cotizaciones (odoo_partner_id, cliente_nombre, pedido_id)
select 777001, 'Inversiones Pérez SAC', id from public.pedidos where codigo = 'P9911-004';

-- ── 3. Sin sesión no contesta nada ──────────────────────────────────────────

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.pedidos_de_cliente(777001, 'Juan Pérez', null))
     or exists (select 1 from public.buscar_pedidos_chat('P9911'))
     or exists (select 1 from public.clientes_de_pedidos('juan')) then
    raise exception 'FALLO: sin sesión se leen pedidos o clientes';
  end if;
end $$;

reset role;

-- ── 4. Operaciones: busca por teléfono pero no lo ve ────────────────────────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d4a3","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_codigos text[];
begin
  -- Por partner (la cotización, que Operaciones no puede leer) más el nombre sin tildes.
  select array_agg(codigo order by codigo) into v_codigos
    from public.pedidos_de_cliente(777001, 'juan perez', null);
  if v_codigos is distinct from array['P9911-001', 'P9911-002', 'P9911-004'] then
    raise exception 'FALLO: pedidos_de_cliente por partner y nombre devolvió %', v_codigos;
  end if;

  -- Por teléfono, con o sin el prefijo del país.
  select array_agg(codigo order by codigo) into v_codigos
    from public.pedidos_de_cliente(null, null, '981000111');
  if v_codigos is distinct from array['P9911-001', 'P9911-003'] then
    raise exception 'FALLO: pedidos_de_cliente por teléfono devolvió %', v_codigos;
  end if;

  -- Un teléfono a medias no trae nada.
  if exists (select 1 from public.pedidos_de_cliente(null, null, '981')) then
    raise exception 'FALLO: un teléfono de tres dígitos encontró pedidos';
  end if;

  -- Código compactado: "p9911003" encuentra "P9911-003" y va primero.
  if (select codigo from public.buscar_pedidos_chat('p9911003') limit 1) <> 'P9911-003' then
    raise exception 'FALLO: buscar_pedidos_chat no puso primero el código exacto';
  end if;
  if (select count(*) from public.buscar_pedidos_chat('P9911')) <> 4 then
    raise exception 'FALLO: buscar_pedidos_chat por prefijo';
  end if;
  if not exists (select 1 from public.buscar_pedidos_chat('perez juan') where codigo = 'P9911-002') then
    raise exception 'FALLO: buscar_pedidos_chat por nombre sin tildes y en otro orden';
  end if;

  -- Los dos "Juan Pérez" son un solo cliente, y sin teléfono para Operaciones.
  if (select count(*) from public.clientes_de_pedidos('juan pérez')) <> 1 then
    raise exception 'FALLO: clientes_de_pedidos no juntó los nombres iguales';
  end if;
  if (select pedidos from public.clientes_de_pedidos('juan pérez')) <> 2 then
    raise exception 'FALLO: clientes_de_pedidos contó mal los pedidos';
  end if;
  if exists (select 1 from public.clientes_de_pedidos('981 000') where telefono is not null) then
    raise exception 'FALLO: Operaciones ve el teléfono del cliente';
  end if;
  if (select count(*) from public.clientes_de_pedidos('981 000')) <> 2 then
    raise exception 'FALLO: Operaciones no puede buscar por teléfono';
  end if;
end $$;

reset role;

-- ── 5. Logística sí ve el teléfono ──────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d4a2","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  if (select telefono from public.clientes_de_pedidos('juan perez')) <> '981 000 111' then
    raise exception 'FALLO: Logística no ve el teléfono más reciente del cliente';
  end if;
  if (select count(*) from public.clientes_de_pedidos('')) < 3 then
    raise exception 'FALLO: sin consulta, clientes_de_pedidos debía traer los recientes';
  end if;
end $$;

reset role;

select 'chat_referencias.sql: todo OK' as resultado;

rollback;
