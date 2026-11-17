-- Verificación de la migración 20261130000100 (transferencias y faltantes),
-- contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/transferencias.sql
--
-- Como almacenes.sql: entra como el primer usuario activo de cada rol y salta lo
-- que no tenga. Todo dentro de una transacción que termina en ROLLBACK.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['transferencias_stock', 'transferencias_stock_lineas', 'faltantes_stock'] loop
    if exists (select 1 from pg_class where relname = t and relnamespace = 'public'::regnamespace and not relrowsecurity) then
      raise exception 'FALLO: falta RLS en %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'FALLO: anon puede leer %', t;
    end if;
  end loop;
  if not exists (select 1 from pg_enum where enumtypid = 'public.estado_sobrante'::regtype and enumlabel = 'en_transito') then
    raise exception 'FALLO: un sobrante no puede estar en tránsito';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.tipo_notificacion'::regtype and enumlabel = 'mover_stock') then
    raise exception 'FALLO: no hay aviso de mover stock';
  end if;
end $$;

-- ── 2. Por rol ──────────────────────────────────────────────────────────────

select set_config('plexi.secuencia', (select last_value || ',' || is_called from public.transferencias_stock_numero_seq), true);
select set_config('plexi.admin', coalesce((select id::text from public.usuarios where rol = 'administracion' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.logistica', coalesce((select id::text from public.usuarios where rol = 'logistica' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.operaciones', coalesce((select id::text from public.usuarios where rol = 'operaciones' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.grupo', (select g.id::text from public.grupos_plancha g join public.formatos_plancha f on f.grupo_id = g.id order by f.codigo_odoo limit 1), true);
select set_config('plexi.taller', (select id::text from public.almacenes where tipo = 'taller'), true);
select set_config('plexi.tienda', (select id::text from public.almacenes where tipo = 'tienda'), true);
select set_config('plexi.pedido', coalesce((select id::text from public.pedidos order by codigo desc limit 1), ''), true);

-- Dos sobrantes en el taller, con código propio.
insert into public.sobrantes (codigo, grupo_id, largo_cm, ancho_cm, almacen_id, odoo_lot_id)
values ('PRUEBA-TRF-1', current_setting('plexi.grupo')::uuid, 100, 50, current_setting('plexi.taller')::uuid, 999001),
       ('PRUEBA-TRF-2', current_setting('plexi.grupo')::uuid, 90, 40, current_setting('plexi.taller')::uuid, 999002);

-- 2.1 Logística envía: el sobrante queda en tránsito y no se puede volver a enviar.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.logistica'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_t public.transferencias_stock%rowtype;
  v_otra uuid;
begin
  if current_setting('plexi.logistica') = '' then
    raise notice 'No hay nadie de Logística: se salta su parte';
    return;
  end if;
  insert into public.transferencias_stock (desde_id, hacia_id) values (current_setting('plexi.taller')::uuid, current_setting('plexi.tienda')::uuid)
  returning * into v_t;
  if v_t.codigo !~ '^TRF-\d{5,}$' or v_t.estado <> 'enviada' or v_t.enviado_por::text <> current_setting('plexi.logistica') then
    raise exception 'FALLO: la transferencia no nació con su código, su estado o su firma';
  end if;
  insert into public.transferencias_stock_lineas (transferencia_id, posicion, producto_odoo_id, codigo, nombre, cantidad, sobrante_codigo)
  values (v_t.id, 1, 5000, 'PRUEBA-TRF-1', 'Sobrante', 1, 'PRUEBA-TRF-1');
  perform public.enviar_sobrantes(v_t.id);
  if (select estado::text from public.sobrantes where codigo = 'PRUEBA-TRF-1') <> 'en_transito' then
    raise exception 'FALLO: el sobrante enviado no quedó en tránsito';
  end if;

  -- Un sobrante en tránsito no sale en otra transferencia.
  insert into public.transferencias_stock (desde_id, hacia_id) values (current_setting('plexi.taller')::uuid, current_setting('plexi.tienda')::uuid)
  returning id into v_otra;
  insert into public.transferencias_stock_lineas (transferencia_id, posicion, producto_odoo_id, nombre, cantidad, sobrante_codigo)
  values (v_otra, 1, 5000, 'Sobrante', 1, 'PRUEBA-TRF-1');
  begin
    perform public.enviar_sobrantes(v_otra);
    raise exception 'FALLO: un sobrante en tránsito salió dos veces';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;

  -- No se transfiere a sí mismo.
  begin
    insert into public.transferencias_stock (desde_id, hacia_id) values (current_setting('plexi.taller')::uuid, current_setting('plexi.taller')::uuid);
    raise exception 'FALLO: se aceptó una transferencia al mismo almacén';
  exception when check_violation then null; end;

  -- Anular devuelve el sobrante al origen; una que ya salió en Odoo no se anula.
  insert into public.transferencias_stock (desde_id, hacia_id) values (current_setting('plexi.taller')::uuid, current_setting('plexi.tienda')::uuid)
  returning id into v_otra;
  insert into public.transferencias_stock_lineas (transferencia_id, posicion, producto_odoo_id, nombre, cantidad, sobrante_codigo)
  values (v_otra, 1, 5000, 'Sobrante', 1, 'PRUEBA-TRF-2');
  perform public.enviar_sobrantes(v_otra);
  perform public.anular_transferencia(v_otra);
  if (select estado::text from public.sobrantes where codigo = 'PRUEBA-TRF-2') <> 'disponible' then
    raise exception 'FALLO: anular no devolvió el sobrante';
  end if;
  update public.transferencias_stock set odoo_envio_id = 77 where id = v_t.id;
  begin
    perform public.anular_transferencia(v_t.id);
    raise exception 'FALLO: se anuló una transferencia que ya salió en Odoo';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;

  perform set_config('plexi.transferencia', v_t.id::text, true);
end $$;
set local role postgres;

-- 2.2 Operaciones ve y recibe, pero no crea ni anula.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.operaciones'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if current_setting('plexi.operaciones') = '' or current_setting('plexi.transferencia', true) is null
     or current_setting('plexi.transferencia', true) = '' then
    raise notice 'Falta Operaciones o Logística: se salta su parte';
    return;
  end if;
  begin
    insert into public.transferencias_stock (desde_id, hacia_id) values (current_setting('plexi.taller')::uuid, current_setting('plexi.tienda')::uuid);
    raise exception 'FALLO: Operaciones creó una transferencia';
  exception when insufficient_privilege then null; end;
  begin
    perform public.anular_transferencia(current_setting('plexi.transferencia')::uuid);
    raise exception 'FALLO: Operaciones anuló una transferencia';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    insert into public.faltantes_stock (pedido_id, producto_odoo_id, nombre, cantidad, almacen_id, motivo)
    values (gen_random_uuid(), 1, 'x', 1, current_setting('plexi.taller')::uuid, 'corte');
    raise exception 'FALLO: Operaciones escribió un faltante';
  exception when insufficient_privilege then null; end;

  perform public.recibir_transferencia(current_setting('plexi.transferencia')::uuid, 88);
  if (select estado from public.transferencias_stock where id = current_setting('plexi.transferencia')::uuid) <> 'recibida' then
    raise exception 'FALLO: Operaciones no pudo recibir';
  end if;
  if (select estado::text || ':' || almacen_id::text from public.sobrantes where codigo = 'PRUEBA-TRF-1')
     <> 'disponible:' || current_setting('plexi.tienda') then
    raise exception 'FALLO: el sobrante recibido no quedó disponible en su almacén nuevo';
  end if;
  -- Recibir dos veces no hace nada.
  perform public.recibir_transferencia(current_setting('plexi.transferencia')::uuid, 88);
end $$;
set local role postgres;

-- 2.3 Administración: un faltante por pedido, producto y almacén; el aviso va a Administración y Logística.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.admin'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_avisos int;
  v_esperados int;
begin
  if current_setting('plexi.admin') = '' or current_setting('plexi.pedido') = '' then
    raise notice 'Falta Administración o un pedido: se salta su parte';
    return;
  end if;
  insert into public.faltantes_stock (pedido_id, producto_odoo_id, codigo, nombre, cantidad, almacen_id, motivo)
  values (current_setting('plexi.pedido')::uuid, 20, 'F7E024', 'Plancha', 2, current_setting('plexi.tienda')::uuid, 'despacho');
  begin
    insert into public.faltantes_stock (pedido_id, producto_odoo_id, nombre, cantidad, almacen_id, motivo)
    values (current_setting('plexi.pedido')::uuid, 20, 'Plancha', 1, current_setting('plexi.tienda')::uuid, 'despacho');
    raise exception 'FALLO: hay dos faltantes abiertos del mismo producto en el mismo almacén';
  exception when unique_violation then null; end;

  select count(*) into v_esperados from public.usuarios where activo and rol in ('administracion', 'logistica');
  v_avisos := public.avisar_faltantes(current_setting('plexi.pedido')::uuid);
  if v_avisos <> v_esperados then
    raise exception 'FALLO: se encolaron % avisos y había % personas de Administración y Logística', v_avisos, v_esperados;
  end if;
end $$;
set local role postgres;

do $$
begin
  if current_setting('plexi.pedido') <> '' and current_setting('plexi.admin') <> '' and not exists (
    select 1 from public.notificaciones where tipo::text = 'mover_stock' and pedido_id = current_setting('plexi.pedido')::uuid
       and titulo like 'Mover stock para %' and cuerpo like '%F7E024 ×2 en %') then
    raise exception 'FALLO: el aviso de mover stock no dice qué falta';
  end if;
end $$;

select setval('public.transferencias_stock_numero_seq',
              split_part(current_setting('plexi.secuencia'), ',', 1)::bigint,
              split_part(current_setting('plexi.secuencia'), ',', 2)::boolean);

select 'transferencias: todo en orden' as resultado;

rollback;
