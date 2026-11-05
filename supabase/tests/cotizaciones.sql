-- Verificación de la migración 20261105000100 (cotizaciones), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/cotizaciones.sql
--
-- Como `comprobante.sql`, no necesita las cuentas del seed: entra como el primer
-- usuario activo de Administración que encuentre (y, si hay, como uno de otro
-- rol). Todo dentro de una transacción que termina en ROLLBACK: no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
declare
  faltan text;
begin
  select string_agg(c, ', ')
    into faltan
    from unnest(array[
      'cotizaciones_sincronizada_con_orden',
      'cotizaciones_error_con_motivo',
      'cotizaciones_odoo_order_id_key'
    ]) as c
   where not exists (
     select 1 from pg_constraint where conrelid = 'public.cotizaciones'::regclass and conname = c
   );
  if faltan is not null then
    raise exception 'FALLO: faltan constraints en cotizaciones: %', faltan;
  end if;

  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'cotizaciones' and column_name = 'canal')
     not like '''tienda''%' then
    raise exception 'FALLO: el canal por defecto no es tienda';
  end if;

  if exists (
    select 1 from pg_class c
     where c.relname in ('clientes_cotizados', 'productos_mas_cotizados')
       and not coalesce(c.reloptions @> array['security_invoker=true'], false)
  ) then
    raise exception 'FALLO: las vistas de sugerencias no son security_invoker';
  end if;

  if not exists (select 1 from pg_class where relname = 'cotizaciones' and relrowsecurity)
     or not exists (select 1 from pg_class where relname = 'cotizacion_productos' and relrowsecurity) then
    raise exception 'FALLO: falta RLS en las tablas de cotizaciones';
  end if;
end $$;

-- ── 2. Como Administración ──────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from public.usuarios where rol = 'administracion' and activo) then
    raise exception 'No hay ningún usuario activo de Administración para probar los permisos';
  end if;
end $$;

select set_config('plexi.test_admin',
                  (select id::text from public.usuarios where rol = 'administracion' and activo
                    order by creado_en limit 1),
                  true);
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('plexi.test_admin'), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  id_form   uuid;
  id_chat   uuid;
  id_chat_2 uuid;
  fila      public.cotizaciones%rowtype;
begin
  -- 2.1 El alta del formulario: cabecera y líneas, pendiente de Odoo.
  id_form := public.crear_cotizacion(
    p_odoo_partner_id := 900001,
    p_cliente_nombre  := '  Prueba SQL Cotización  ',
    p_lineas := '[
      {"odoo_product_id": 10, "producto_nombre": "ACRILICO F8 CRISTAL 3MM", "producto_codigo": "AC-003",
       "cantidad": 2.5, "precio_unitario": 120, "descripcion": "corte 30x50"},
      {"odoo_product_id": 14, "producto_nombre": "SERVICIO CORTE LASER", "producto_codigo": "",
       "cantidad": 30, "precio_unitario": 1.5, "descripcion": "  "}
    ]'::jsonb
  );

  select * into fila from public.cotizaciones where id = id_form;
  if fila.canal <> 'tienda' or fila.sincronizacion <> 'pendiente' or fila.odoo_order_id is not null then
    raise exception 'FALLO: el alta no quedó como tienda/pendiente: % %', fila.canal, fila.sincronizacion;
  end if;
  if fila.cliente_nombre <> 'Prueba SQL Cotización' then
    raise exception 'FALLO: no se recortó el nombre del cliente: "%"', fila.cliente_nombre;
  end if;
  if fila.creado_por::text <> current_setting('plexi.test_admin') then
    raise exception 'FALLO: creado_por no es quien llamó';
  end if;
  if (select count(*) from public.cotizacion_productos where cotizacion_id = id_form) <> 2 then
    raise exception 'FALLO: no se guardaron las dos líneas';
  end if;
  if (select array_agg(posicion order by posicion) from public.cotizacion_productos where cotizacion_id = id_form)
     <> array[1, 2]::smallint[] then
    raise exception 'FALLO: las posiciones no son 1 y 2';
  end if;
  -- El código y el detalle vacíos quedan en NULL, no en "".
  if exists (select 1 from public.cotizacion_productos
              where cotizacion_id = id_form and posicion = 2
                and (producto_codigo is not null or descripcion is not null)) then
    raise exception 'FALLO: los textos vacíos de la línea no quedaron en NULL';
  end if;

  -- 2.2 Sin líneas no hay cotización.
  begin
    perform public.crear_cotizacion(900001, 'Sin líneas', '[]'::jsonb);
    raise exception 'FALLO: se creó una cotización sin productos';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'Una cotización necesita al menos un producto%' then
      raise exception 'FALLO: error inesperado sin líneas: %', sqlerrm;
    end if;
  end;

  -- 2.3 Una línea con cantidad cero no entra.
  begin
    perform public.crear_cotizacion(900001, 'Cantidad cero',
      '[{"odoo_product_id": 10, "producto_nombre": "X", "cantidad": 0, "precio_unitario": 1}]'::jsonb);
    raise exception 'FALLO: se aceptó una cantidad cero';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;

  -- 2.4 El estado de Odoo y la orden van juntos.
  begin
    update public.cotizaciones set sincronizacion = 'sincronizada' where id = id_form;
    raise exception 'FALLO: quedó sincronizada sin orden de Odoo';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    update public.cotizaciones set sincronizacion = 'error' where id = id_form;
    raise exception 'FALLO: quedó en error sin motivo';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  update public.cotizaciones
     set sincronizacion = 'error', error_sincronizacion = 'Odoo no respondió'
   where id = id_form;
  update public.cotizaciones
     set sincronizacion = 'sincronizada', error_sincronizacion = null,
         odoo_order_id = 900001, odoo_order_name = 'S99001', monto_total = 413.0
   where id = id_form;

  -- 2.5 Lo cotizado no se edita: solo el resultado de Odoo.
  begin
    update public.cotizaciones set canal = 'whatsapp' where id = id_form;
    raise exception 'FALLO: se pudo cambiar el canal después del alta';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- 2.6 Lo que crea el asistente llega ya sincronizado, y repetirlo no duplica.
  id_chat := public.crear_cotizacion(
    p_odoo_partner_id := 900002, p_cliente_nombre := 'Prueba SQL Asistente',
    p_lineas := '[{"odoo_product_id": 10, "producto_nombre": "ACRILICO", "cantidad": 5, "precio_unitario": 20}]'::jsonb,
    p_odoo_order_id := 900002, p_odoo_order_name := 'S99002', p_monto_total := 118,
    p_chat_agente_id := 'chat-de-prueba'
  );
  id_chat_2 := public.crear_cotizacion(
    p_odoo_partner_id := 900002, p_cliente_nombre := 'Prueba SQL Asistente',
    p_lineas := '[{"odoo_product_id": 10, "producto_nombre": "ACRILICO", "cantidad": 5, "precio_unitario": 20}]'::jsonb,
    p_odoo_order_id := 900002, p_odoo_order_name := 'S99002', p_chat_agente_id := 'chat-de-prueba'
  );
  if id_chat_2 <> id_chat then
    raise exception 'FALLO: registrar dos veces la misma orden devolvió otra fila';
  end if;
  if (select sincronizacion from public.cotizaciones where id = id_chat) <> 'sincronizada' then
    raise exception 'FALLO: la del asistente no quedó sincronizada';
  end if;
  if (select count(*) from public.cotizacion_productos where cotizacion_id = id_chat) <> 1 then
    raise exception 'FALLO: la segunda llamada del asistente duplicó líneas';
  end if;

  -- 2.7 Una orden de Odoo es una sola cotización.
  begin
    update public.cotizaciones set odoo_order_id = 900002 where id = id_form;
    raise exception 'FALLO: dos cotizaciones apuntan a la misma orden de Odoo';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- 2.8 Las sugerencias cuentan lo cotizado.
  if (select veces from public.productos_mas_cotizados where odoo_product_id = 10) < 2 then
    raise exception 'FALLO: productos_mas_cotizados no cuenta el producto 10 dos veces';
  end if;
  if not exists (select 1 from public.clientes_cotizados
                  where odoo_partner_id = 900002 and cliente_nombre = 'Prueba SQL Asistente') then
    raise exception 'FALLO: clientes_cotizados no tiene al cliente del asistente';
  end if;
end $$;

set local role postgres;

-- ── 3. Otro rol no ve ni crea ───────────────────────────────────────────────

select set_config('plexi.test_otro',
                  coalesce((select id::text from public.usuarios where rol <> 'administracion' and activo
                             order by creado_en limit 1), ''),
                  true);

do $$
begin
  if current_setting('plexi.test_otro') = '' then
    raise notice 'No hay usuarios activos fuera de Administración: se salta la prueba de otro rol';
  end if;
end $$;

select set_config('request.jwt.claims',
                  json_build_object('sub', nullif(current_setting('plexi.test_otro'), ''), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
begin
  if current_setting('plexi.test_otro') = '' then return; end if;

  if (select count(*) from public.cotizaciones) > 0 then
    raise exception 'FALLO: un rol que no es Administración ve cotizaciones';
  end if;
  if (select count(*) from public.productos_mas_cotizados) > 0 then
    raise exception 'FALLO: las sugerencias dejan ver cotizaciones a otro rol';
  end if;

  begin
    perform public.crear_cotizacion(900003, 'Prueba SQL Intrusa',
      '[{"odoo_product_id": 10, "producto_nombre": "X", "cantidad": 1, "precio_unitario": 1}]'::jsonb);
    raise exception 'FALLO: otro rol pudo crear una cotización';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

select 'cotizaciones: todo en orden' as resultado;

rollback;
