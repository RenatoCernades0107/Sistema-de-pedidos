-- Verificación de la migración 20261216000100 (compras y costos).
--
--   npx supabase db query --linked -f supabase/tests/compras_costos.sql
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
  foreach t in array array['compras', 'compras_lineas', 'compras_gastos', 'compras_recepciones',
                           'compras_recepciones_lineas', 'costos_historial', 'margenes_plancha', 'cambios_precio'] loop
    if exists (select 1 from pg_class where relname = t and relnamespace = 'public'::regnamespace and not relrowsecurity) then
      raise exception 'FALLO: falta RLS en %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'FALLO: anon puede leer %', t;
    end if;
  end loop;
  if not exists (select 1 from public.configuracion where clave = 'costos_precios') then
    raise exception 'FALLO: falta la configuración costos_precios';
  end if;
  -- Los ingresos de compra de antes quedaron en el historial.
  if (select count(*) from public.costos_historial where origen = 'ingreso')
     <> (select count(*) from public.ingresos_stock i join public.ingresos_stock_lineas l on l.ingreso_id = i.id
         where i.tipo = 'compra' and l.costo_unitario is not null and l.cantidad > 0) then
    raise exception 'FALLO: el historial no trae todos los ingresos de compra';
  end if;
end $$;

select set_config('plexi.admin', coalesce((select id::text from public.usuarios where rol = 'administracion' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.logistica', coalesce((select id::text from public.usuarios where rol = 'logistica' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.ventas', coalesce((select id::text from public.usuarios where rol = 'ventas' and activo order by creado_en limit 1), ''), true);
select set_config('plexi.almacen', (select id::text from public.almacenes where activo order by orden limit 1), true);

-- ── 2. Logística: crea la compra, sus ítems, gastos y el historial ──────────

select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.logistica'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  c uuid;
begin
  if current_setting('plexi.logistica') = '' then
    raise notice 'No hay nadie de Logística: se salta su parte';
    return;
  end if;

  insert into public.compras (tipo, proveedor_odoo_id, proveedor_nombre, almacen_id, moneda_mercaderia, tc_mercaderia, tc_gastos, incoterm, condicion_pago, dias_credito)
  values ('importacion', 1, 'PROVEEDOR DE PRUEBA', current_setting('plexi.almacen')::uuid, 'USD', 3.75, 3.8, 'FOB', 'credito', 90)
  returning id into c;
  if (select codigo from public.compras where id = c) !~ '^CMP-\d{5}$' then
    raise exception 'FALLO: el código de la compra no es CMP-00000';
  end if;

  insert into public.compras_lineas (compra_id, posicion, producto_odoo_id, nombre, cantidad, kilos, precio_unitario)
  values (c, 1, 10, 'PLANCHA A', 10, 100, 100), (c, 2, 11, 'PLANCHA B', 5, 300, 30);

  insert into public.compras_gastos (compra_id, concepto, moneda, monto, reparto, tipo_mano_obra, personas, horas, tarifa)
  values (c, 'mano_obra', 'PEN', 50, 'peso', 'descarga', 2, 2.5, 10);

  begin
    insert into public.compras_gastos (compra_id, concepto, moneda, monto, reparto)
    values (c, 'mano_obra', 'PEN', 50, 'peso');
    raise exception 'FALLO: aceptó mano de obra sin horas ni tarifa';
  exception when check_violation then null;
  end;

  begin
    update public.compras_lineas set cantidad_recibida = 11 where compra_id = c and posicion = 1;
    raise exception 'FALLO: aceptó recibir más de lo pedido';
  exception when check_violation then null;
  end;

  begin
    insert into public.compras (tipo, proveedor_odoo_id, proveedor_nombre, almacen_id, incoterm)
    values ('nacional', 1, 'X', current_setting('plexi.almacen')::uuid, 'FOB');
    raise exception 'FALLO: una compra nacional aceptó incoterm';
  exception when check_violation then null;
  end;

  insert into public.costos_historial (producto_odoo_id, nombre, origen, compra_id, fecha, cantidad, costo_unitario_pen)
  values (10, 'PLANCHA A', 'liquidacion', c, current_date, 10, 388.3);

  insert into public.compras_recepciones (compra_id) values (c);

  if (select (config_tarifas_mano_obra() ? 'descarga')) is not true then
    raise exception 'FALLO: Logística no lee la tarifa de mano de obra';
  end if;

  -- Los márgenes y el historial de precios son de Administración.
  if exists (select 1 from public.margenes_plancha) or exists (select 1 from public.cambios_precio) then
    raise exception 'FALLO: Logística ve márgenes o cambios de precio';
  end if;
  begin
    insert into public.margenes_plancha (codigo_odoo, margen_pct) values ('X', 10);
    raise exception 'FALLO: Logística escribió un margen';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role postgres;

-- ── 3. Ventas: no ve compras ni costos ──────────────────────────────────────

select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.ventas'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if current_setting('plexi.ventas') = '' then
    raise notice 'No hay nadie de Ventas: se salta su parte';
    return;
  end if;
  if exists (select 1 from public.compras) or exists (select 1 from public.costos_historial)
     or exists (select 1 from public.compras_gastos) then
    raise exception 'FALLO: Ventas ve compras o costos';
  end if;
  if config_tarifas_mano_obra() is not null then
    raise exception 'FALLO: Ventas lee la tarifa de mano de obra';
  end if;
  begin
    insert into public.compras (tipo, proveedor_odoo_id, proveedor_nombre, almacen_id)
    values ('nacional', 1, 'X', current_setting('plexi.almacen')::uuid);
    raise exception 'FALLO: Ventas creó una compra';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role postgres;

-- ── 4. Administración: márgenes y precios ───────────────────────────────────

select set_config('request.jwt.claims', json_build_object('sub', nullif(current_setting('plexi.admin'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if current_setting('plexi.admin') = '' then
    raise notice 'No hay nadie de Administración: se salta su parte';
    return;
  end if;
  insert into public.margenes_plancha (codigo_odoo, margen_pct) values ('PRUEBA-MARGEN', 35);
  insert into public.cambios_precio (producto_odoo_id, nombre, precio_anterior, precio_nuevo, costo_base, margen_pct)
  values (10, 'PLANCHA A', 100, 120, 70, 30);
  begin
    insert into public.margenes_plancha (codigo_odoo, margen_pct) values ('PRUEBA-MARGEN-2', 100);
    raise exception 'FALLO: aceptó un margen de 100%%';
  exception when check_violation then null;
  end;
end $$;
set local role postgres;

select 'compras y costos: todo en orden' as resultado;

rollback;
