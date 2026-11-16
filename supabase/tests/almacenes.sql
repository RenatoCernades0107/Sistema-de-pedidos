-- Verificación de las migraciones 20261129000100 (almacenes) y 20261129000200
-- (accesorios), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/almacenes.sql
--
-- No necesita las cuentas del seed: entra como el primer usuario activo de cada
-- rol y, si un rol no tiene ninguno, se salta esa parte. Todo dentro de una
-- transacción que termina en ROLLBACK.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['almacenes', 'categorias_accesorio', 'accesorios', 'ingresos_stock', 'ingresos_stock_lineas'] loop
    if exists (select 1 from pg_class where relname = t and relnamespace = 'public'::regnamespace and not relrowsecurity) then
      raise exception 'FALLO: falta RLS en %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'FALLO: anon puede leer %', t;
    end if;
  end loop;

  -- 1.1 Los tres almacenes, con su papel.
  if (select string_agg(codigo || ':' || tipo, ',' order by orden) from public.almacenes where codigo in ('AND', 'CAT', 'ESM'))
     <> 'AND:tienda,CAT:taller,ESM:deposito' then
    raise exception 'FALLO: los almacenes sembrados no son Andahuaylas (tienda), Católica (taller) y Esmeraldas';
  end if;

  -- 1.2 Cada color tiene su código: ya no hay código compartido. Y todos registran sobrantes.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'formatos_plancha' and column_name = 'sku_compartido') then
    raise exception 'FALLO: sigue la columna sku_compartido';
  end if;
  if exists (select 1 from public.grupos_plancha where not sobrantes_activo) then
    raise exception 'FALLO: hay materiales sin sobrantes';
  end if;

  -- 1.3 Los accesorios de la lista, en sus categorías.
  if (select count(*) from public.accesorios) < 50 then
    raise exception 'FALLO: faltan los accesorios sembrados';
  end if;
  if not exists (select 1 from public.accesorios a join public.categorias_accesorio c on c.id = a.categoria_id
                  where a.codigo_odoo = 'PEG012' and c.prefijo = 'PEG') then
    raise exception 'FALLO: un adhesivo no quedó en su categoría';
  end if;

  -- 1.4 Un sobrante necesita su almacén.
  if (select is_nullable from information_schema.columns where table_schema = 'public'
        and table_name = 'sobrantes' and column_name = 'almacen_id') <> 'NO' then
    raise exception 'FALLO: un sobrante puede quedar sin almacén';
  end if;

  -- 1.5 El almacén de despacho se escribe (las columnas de cotizaciones se conceden una por una).
  if not has_column_privilege('authenticated', 'public.cotizaciones', 'almacen_despacho_id', 'UPDATE') then
    raise exception 'FALLO: no se puede anotar el almacén de despacho de una cotización';
  end if;

  -- 1.6 Un solo taller y una sola tienda.
  begin
    insert into public.almacenes (nombre, codigo, tipo) values ('Otro taller', 'OTT', 'taller');
    raise exception 'FALLO: se aceptó un segundo taller';
  exception when unique_violation then null; end;
end $$;

-- ── 2. Por rol ──────────────────────────────────────────────────────────────

-- La secuencia de los ingresos no vuelve atrás con el ROLLBACK: se guarda cómo
-- está y se deja igual al final, para no saltar la numeración de verdad.
select set_config('plexi.secuencia_ingresos',
                  (select last_value || ',' || is_called from public.ingresos_stock_numero_seq),
                  true);

select set_config('plexi.admin', coalesce((select id::text from public.usuarios where rol = 'administracion' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.logistica', coalesce((select id::text from public.usuarios where rol = 'logistica' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.operaciones', coalesce((select id::text from public.usuarios where rol = 'operaciones' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.grupo', (select g.id::text from public.grupos_plancha g join public.formatos_plancha f on f.grupo_id = g.id order by f.codigo_odoo limit 1), true);
select set_config('plexi.categoria', (select id::text from public.categorias_accesorio order by orden limit 1), true);

-- Un sobrante para probar el precio, con código propio (no gasta la secuencia).
insert into public.sobrantes (codigo, grupo_id, largo_cm, ancho_cm, almacen_id)
values ('PRUEBA-ALM-1', current_setting('plexi.grupo')::uuid, 100, 50, (select id from public.almacenes where tipo = 'taller'));

-- 2.1 Operaciones: ve los almacenes, no los cambia ni ve los ingresos.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.operaciones'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if current_setting('plexi.operaciones') = '' then
    raise notice 'No hay nadie de Operaciones: se salta su parte';
    return;
  end if;
  if (select count(*) from public.almacenes) < 3 then raise exception 'FALLO: Operaciones no ve los almacenes'; end if;
  if (select count(*) from public.accesorios) = 0 then raise exception 'FALLO: Operaciones no ve los accesorios'; end if;
  begin
    insert into public.almacenes (nombre, codigo) values ('Prueba op', 'PRBOP');
    raise exception 'FALLO: Operaciones creó un almacén';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.ingresos_stock (tipo, almacen_id) values ('ajuste', (select id from public.almacenes limit 1));
    raise exception 'FALLO: Operaciones registró un ingreso';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.accesorios (codigo_odoo, categoria_id) values ('PRUEBA-OP', current_setting('plexi.categoria')::uuid);
    raise exception 'FALLO: Operaciones agregó un accesorio';
  exception when insufficient_privilege then null; end;
  begin
    update public.sobrantes set precio_venta = 1 where codigo = 'PRUEBA-ALM-1';
    raise exception 'FALLO: Operaciones cambió el precio de un sobrante';
  exception when insufficient_privilege then null; end;
  if (public.config_almacen() ->> 'factorSobrante')::numeric <= 1 then
    raise exception 'FALLO: config_almacen() no da el factor del sobrante';
  end if;
end $$;
set local role postgres;

-- 2.2 Logística: gestiona el stock, pero no cambia precios.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.logistica'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_ingreso public.ingresos_stock%rowtype;
begin
  if current_setting('plexi.logistica') = '' then
    raise notice 'No hay nadie de Logística: se salta su parte';
    return;
  end if;
  insert into public.almacenes (nombre, codigo) values ('Prueba Logística', 'PRBLG');
  insert into public.ingresos_stock (tipo, almacen_id) values ('ajuste', (select id from public.almacenes where codigo = 'PRBLG'))
  returning * into v_ingreso;
  if v_ingreso.codigo !~ '^ING-\d{5,}$' or v_ingreso.creado_por::text <> current_setting('plexi.logistica') then
    raise exception 'FALLO: el ingreso no nació con su código o su firma';
  end if;
  insert into public.ingresos_stock_lineas (ingreso_id, posicion, producto_odoo_id, nombre, cantidad)
  values (v_ingreso.id, 1, 20, 'Prueba', 3);
  begin
    insert into public.ingresos_stock (tipo, almacen_id) values ('compra', v_ingreso.almacen_id);
    raise exception 'FALLO: se aceptó una compra sin proveedor';
  exception when check_violation then null; end;
  insert into public.accesorios (codigo_odoo, categoria_id) values ('PRUEBA-LG', current_setting('plexi.categoria')::uuid);
  -- Crea planchas nuevas, pero no cambia las del catálogo.
  insert into public.grupos_plancha (material, espesor_mm) values ('Prueba Logística', 3);
  update public.grupos_plancha set rotable = rotable where id = current_setting('plexi.grupo')::uuid;
  if found then raise exception 'FALLO: Logística cambió el catálogo'; end if;
  begin
    perform public.fijar_precio_sobrante('PRUEBA-ALM-1', 10);
    raise exception 'FALLO: Logística fijó el precio de un sobrante';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;
set local role postgres;

-- 2.3 Administración: fija el precio de un sobrante, y lo devuelve al calculado.
select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.admin'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if current_setting('plexi.admin') = '' then
    raise notice 'No hay nadie de Administración: se salta su parte';
    return;
  end if;
  perform public.fijar_precio_sobrante('PRUEBA-ALM-1', 25.5);
  if (select precio_venta from public.sobrantes where codigo = 'PRUEBA-ALM-1') <> 25.5 then
    raise exception 'FALLO: Administración no fijó el precio';
  end if;
  perform public.fijar_precio_sobrante('PRUEBA-ALM-1', null);
  if (select precio_venta from public.sobrantes where codigo = 'PRUEBA-ALM-1') is not null then
    raise exception 'FALLO: el precio no volvió al calculado';
  end if;
end $$;
set local role postgres;

select setval('public.ingresos_stock_numero_seq',
              split_part(current_setting('plexi.secuencia_ingresos'), ',', 1)::bigint,
              split_part(current_setting('plexi.secuencia_ingresos'), ',', 2)::boolean);

select 'almacenes: todo en orden' as resultado;

rollback;
