-- Verificación de la migración 20261201000100 (casos y conteos), contra el
-- proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/casos.sql
--
-- Como almacenes.sql: entra como el primer usuario activo de cada rol y salta lo
-- que no tenga. Todo dentro de una transacción que termina en ROLLBACK.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['casos_stock', 'conteos_stock', 'conteos_stock_lineas', 'conteos_stock_sobrantes'] loop
    if exists (select 1 from pg_class where relname = t and relnamespace = 'public'::regnamespace and not relrowsecurity) then
      raise exception 'FALLO: falta RLS en %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'FALLO: anon puede leer %', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.casos_stock', 'estado', 'UPDATE') then
    raise exception 'FALLO: el estado de un caso se cambia sin cerrar_caso';
  end if;
end $$;

-- ── 2. Por rol ──────────────────────────────────────────────────────────────

select set_config('plexi.secuencias',
  (select c.last_value || ',' || c.is_called || ';' || n.last_value || ',' || n.is_called
     from public.casos_stock_numero_seq c, public.conteos_stock_numero_seq n), true);
select set_config('plexi.admin', coalesce((select id::text from public.usuarios where rol = 'administracion' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.logistica', coalesce((select id::text from public.usuarios where rol = 'logistica' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.operaciones', coalesce((select id::text from public.usuarios where rol = 'operaciones' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.admins', (select count(*)::text from public.usuarios where activo and rol = 'administracion'), true);
select set_config('plexi.taller', (select id::text from public.almacenes where tipo = 'taller'), true);
select set_config('plexi.grupo', (select g.id::text from public.grupos_plancha g join public.formatos_plancha f on f.grupo_id = g.id order by f.codigo_odoo limit 1), true);

insert into public.sobrantes (codigo, grupo_id, largo_cm, ancho_cm, almacen_id, odoo_lot_id)
values ('PRUEBA-CAS-1', current_setting('plexi.grupo')::uuid, 100, 50, current_setting('plexi.taller')::uuid, 999101);

-- 2.1 Logística reporta y cuenta, pero no cierra.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.logistica'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_caso public.casos_stock%rowtype;
  v_conteo uuid;
begin
  if current_setting('plexi.logistica') = '' then
    raise notice 'No hay nadie de Logística: se salta su parte';
    return;
  end if;
  insert into public.casos_stock (tipo, almacen_id, producto_odoo_id, codigo_producto, nombre, cantidad, motivo)
  values ('baja', current_setting('plexi.taller')::uuid, 20, 'F7E024', 'Plancha', -2, 'rotura')
  returning * into v_caso;
  if v_caso.codigo !~ '^CAS-\d{5,}$' or v_caso.reportado_por::text <> current_setting('plexi.logistica') then
    raise exception 'FALLO: el caso no nació con su código o su firma';
  end if;
  perform set_config('plexi.caso', v_caso.id::text, true);

  -- Una baja es negativa y lleva motivo; no se reporta ya cerrada.
  begin
    insert into public.casos_stock (tipo, almacen_id, producto_odoo_id, nombre, cantidad, motivo)
    values ('baja', current_setting('plexi.taller')::uuid, 20, 'Plancha', 1, 'rotura');
    raise exception 'FALLO: se aceptó una baja positiva';
  exception when check_violation then null; end;
  begin
    insert into public.casos_stock (tipo, almacen_id, producto_odoo_id, nombre, cantidad, motivo, estado, razon_cierre)
    values ('baja', current_setting('plexi.taller')::uuid, 20, 'Plancha', -1, 'rotura', 'aplicado', 'Ya estaba roto');
    raise exception 'FALLO: Logística reportó un caso ya cerrado';
  exception when insufficient_privilege then null; end;

  -- Un sobrante no tiene dos casos abiertos.
  insert into public.casos_stock (tipo, almacen_id, producto_odoo_id, nombre, cantidad, motivo, sobrante_codigo)
  values ('baja', current_setting('plexi.taller')::uuid, 5000, 'Sobrante', -1, 'perdido', 'PRUEBA-CAS-1');
  begin
    insert into public.casos_stock (tipo, almacen_id, producto_odoo_id, nombre, cantidad, motivo, sobrante_codigo)
    values ('baja', current_setting('plexi.taller')::uuid, 5000, 'Sobrante', -1, 'rotura', 'PRUEBA-CAS-1');
    raise exception 'FALLO: un sobrante tiene dos casos abiertos';
  exception when unique_violation then null; end;

  begin
    perform public.cerrar_caso(v_caso.id, 'aplicar', 'Se rompió al descargar');
    raise exception 'FALLO: Logística cerró un caso';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;

  -- Un conteo enviado ya no se toca.
  insert into public.conteos_stock (almacen_id, alcance) values (current_setting('plexi.taller')::uuid, 'Prueba') returning id into v_conteo;
  insert into public.conteos_stock_lineas (conteo_id, producto_odoo_id, nombre, contado) values (v_conteo, 20, 'Plancha', 3);
  perform public.enviar_conteo(v_conteo, 0, 1);
  update public.conteos_stock_lineas set contado = 9 where conteo_id = v_conteo;
  if (select contado from public.conteos_stock_lineas where conteo_id = v_conteo) <> 3 then
    raise exception 'FALLO: se cambió lo contado de un conteo enviado';
  end if;
  begin
    perform public.enviar_conteo(v_conteo, 0, 1);
    raise exception 'FALLO: un conteo se envió dos veces';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;

  -- El aviso es solo para Administración.
  if public.avisar_casos(array[v_caso.codigo]) <> current_setting('plexi.admins')::int then
    raise exception 'FALLO: el aviso del caso no fue a toda Administración';
  end if;
end $$;
set local role postgres;

-- 2.2 El taller no ve casos ni conteos.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.operaciones'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if current_setting('plexi.operaciones') = '' then
    raise notice 'No hay nadie de Operaciones: se salta su parte';
    return;
  end if;
  if exists (select 1 from public.casos_stock) or exists (select 1 from public.conteos_stock) then
    raise exception 'FALLO: el taller ve casos o conteos';
  end if;
  begin
    insert into public.casos_stock (tipo, almacen_id, producto_odoo_id, nombre, cantidad, motivo)
    values ('baja', current_setting('plexi.taller')::uuid, 20, 'Plancha', -1, 'rotura');
    raise exception 'FALLO: el taller reportó un caso';
  exception when insufficient_privilege then null; end;
end $$;
set local role postgres;

-- 2.3 Administración cierra con razón; el sobrante dado de baja sale del almacén.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.admin'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_sobrante uuid;
begin
  if current_setting('plexi.admin') = '' or coalesce(current_setting('plexi.caso', true), '') = '' then
    raise notice 'Falta Administración o Logística: se salta su parte';
    return;
  end if;
  begin
    perform public.cerrar_caso(current_setting('plexi.caso')::uuid, 'aplicar', 'ok');
    raise exception 'FALLO: se cerró un caso sin razón';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
  perform public.cerrar_caso(current_setting('plexi.caso')::uuid, 'descartar', 'Apareció en el rack 3');
  if (select estado || ':' || cerrado_por::text from public.casos_stock where id = current_setting('plexi.caso')::uuid)
     <> 'descartado:' || current_setting('plexi.admin') then
    raise exception 'FALLO: el caso no quedó descartado y firmado';
  end if;
  begin
    perform public.cerrar_caso(current_setting('plexi.caso')::uuid, 'aplicar', 'Otra vez');
    raise exception 'FALLO: se cerró dos veces';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;

  select id into v_sobrante from public.casos_stock where sobrante_codigo = 'PRUEBA-CAS-1' and estado = 'pendiente';
  perform public.cerrar_caso(v_sobrante, 'aplicar', 'Se perdió en la mudanza', 77);
  if (select estado::text from public.sobrantes where codigo = 'PRUEBA-CAS-1') <> 'baja' then
    raise exception 'FALLO: el sobrante dado de baja sigue en el almacén';
  end if;
  if (select odoo_ref from public.casos_stock where id = v_sobrante) <> 77 then
    raise exception 'FALLO: el caso aplicado no guardó su referencia de Odoo';
  end if;
end $$;
set local role postgres;

select setval('public.casos_stock_numero_seq',
              split_part(split_part(current_setting('plexi.secuencias'), ';', 1), ',', 1)::bigint,
              split_part(split_part(current_setting('plexi.secuencias'), ';', 1), ',', 2)::boolean);
select setval('public.conteos_stock_numero_seq',
              split_part(split_part(current_setting('plexi.secuencias'), ';', 2), ',', 1)::bigint,
              split_part(split_part(current_setting('plexi.secuencias'), ';', 2), ',', 2)::boolean);

select 'casos: todo en orden' as resultado;

rollback;
