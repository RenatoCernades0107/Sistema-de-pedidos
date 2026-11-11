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

-- ── 2b. Un pedido a partir de una cotización (20261106000100) ───────────────

do $$
declare
  id_cot       uuid;
  id_pendiente uuid;
  v_codigo     text;
  id_pedido    uuid;
begin
  id_cot := public.crear_cotizacion(
    p_odoo_partner_id := 900004, p_cliente_nombre := 'Prueba SQL Pedido',
    p_lineas := '[{"odoo_product_id": 10, "producto_nombre": "ACRILICO", "cantidad": 2, "precio_unitario": 50}]'::jsonb,
    p_odoo_order_id := 900004, p_odoo_order_name := 'S99004', p_monto_total := 118
  );
  id_pendiente := public.crear_cotizacion(900005, 'Prueba SQL Pendiente',
    '[{"odoo_product_id": 10, "producto_nombre": "ACRILICO", "cantidad": 1, "precio_unitario": 1}]'::jsonb);

  -- 2b.1 El alta vincula la cotización y respeta la ubicación elegida.
  v_codigo := public.crear_pedido(
    p_es_provincia := false, p_nombre_cliente := 'Prueba SQL Pedido',
    p_tipos_pedido := array['SP']::public.tipo_pedido[], p_cantidad := 2,
    p_tipo_pago := 'credito', p_lugar_entrega := 'tienda',
    p_fecha_prometida := current_date + 3, p_monto_total := 118,
    p_ubicacion_actual := 'tienda', p_cotizacion_id := id_cot
  );
  select id into id_pedido from public.pedidos where codigo = v_codigo;
  if (select pedido_id from public.cotizaciones where id = id_cot) is distinct from id_pedido then
    raise exception 'FALLO: la cotización no quedó vinculada al pedido %', v_codigo;
  end if;
  if (select ubicacion_actual from public.pedidos where id = id_pedido) <> 'tienda' then
    raise exception 'FALLO: el pedido no quedó en tienda';
  end if;

  -- 2b.2 Un segundo pedido de la misma cotización se rechaza, y no deja pedido suelto.
  begin
    perform public.crear_pedido(
      p_es_provincia := false, p_nombre_cliente := 'Prueba SQL Pedido Doble',
      p_tipos_pedido := array['SP']::public.tipo_pedido[], p_cantidad := 1,
      p_tipo_pago := 'credito', p_lugar_entrega := 'tienda',
      p_fecha_prometida := current_date + 3, p_cotizacion_id := id_cot
    );
    raise exception 'FALLO: una cotización generó dos pedidos';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'Esa cotización ya tiene un pedido%' then
      raise exception 'FALLO: error inesperado con el segundo pedido: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.pedidos_admin where nombre_cliente = 'Prueba SQL Pedido Doble') then
    raise exception 'FALLO: el segundo pedido quedó registrado sin vínculo';
  end if;

  -- 2b.3 Una cotización que todavía no está en Odoo también da pedido (20261110000300):
  -- con Odoo caído se registra igual, y se sincroniza después.
  v_codigo := public.crear_pedido(
    p_es_provincia := false, p_nombre_cliente := 'Prueba SQL Pendiente',
    p_tipos_pedido := array['SP']::public.tipo_pedido[], p_cantidad := 1,
    p_tipo_pago := 'credito', p_lugar_entrega := 'tienda',
    p_fecha_prometida := current_date + 3, p_cotizacion_id := id_pendiente
  );
  if (select pedido_id from public.cotizaciones where id = id_pendiente) is null then
    raise exception 'FALLO: la cotización pendiente no quedó vinculada a su pedido';
  end if;

  -- 2b.3b Las líneas del pedido, con precios para Administración.
  if (select count(*) from public.lineas_de_pedido(v_codigo)) <> 1
     or (select importe is null and precio_unitario is null from public.lineas_de_pedido(v_codigo)) is distinct from false then
    raise exception 'FALLO: Administración no ve las líneas del pedido con sus precios';
  end if;
  if (select odoo_order_id from public.odoo_de_pedido(v_codigo)) is not null then
    raise exception 'FALLO: odoo_de_pedido inventó una orden de Odoo';
  end if;

  -- 2b.4 La confirmación en Odoo se anota.
  update public.cotizaciones set confirmada_en_odoo = true, error_confirmacion = null where id = id_cot;
end $$;

-- 2b.5 Borrar el pedido suelta la cotización (como postgres: borrar es otra prueba).
set local role postgres;
do $$
declare
  id_cot uuid := (select id from public.cotizaciones where odoo_order_id = 900004);
begin
  delete from public.pedidos where id = (select pedido_id from public.cotizaciones where id = id_cot);
  if (select pedido_id from public.cotizaciones where id = id_cot) is not null then
    raise exception 'FALLO: borrar el pedido no soltó la cotización';
  end if;
end $$;
set local role authenticated;

-- ── 2c. Cortes a medida dentro de la cotización (20261110000200) ────────────

do $$
declare
  id_cot uuid;
  fila   public.cotizacion_productos%rowtype;
begin
  -- 2c.1 Una línea de corte guarda su cálculo y su importe; la de producto, no.
  id_cot := public.crear_cotizacion(
    p_odoo_partner_id := 900006, p_cliente_nombre := 'Prueba SQL Corte',
    p_lineas := '[
      {"tipo": "corte", "odoo_product_id": 20, "producto_nombre": "ACRILICO ECO CRISTAL 3MM",
       "producto_codigo": "F7E024", "cantidad": 3, "precio_unitario": 173.33, "importe": 545,
       "descripcion": "Corte láser: 10 × 60×80 cm",
       "corte": {"version": 1, "modalidad": "laser", "total": 545}},
      {"odoo_product_id": 10, "producto_nombre": "BISAGRA", "cantidad": 4, "precio_unitario": 2.5}
    ]'::jsonb
  );

  select * into fila from public.cotizacion_productos where cotizacion_id = id_cot and posicion = 1;
  if fila.tipo <> 'corte' or fila.importe <> 545 or fila.corte ->> 'modalidad' <> 'laser' then
    raise exception 'FALLO: la línea de corte no guardó su cálculo';
  end if;
  select * into fila from public.cotizacion_productos where cotizacion_id = id_cot and posicion = 2;
  if fila.tipo <> 'producto' or fila.corte is not null or fila.importe is not null then
    raise exception 'FALLO: la línea de producto quedó con datos de corte';
  end if;

  -- 2c.2 Un corte sin cálculo no entra.
  begin
    perform public.crear_cotizacion(900006, 'Prueba SQL Corte',
      '[{"tipo": "corte", "odoo_product_id": 20, "producto_nombre": "X", "cantidad": 1,
         "precio_unitario": 1, "importe": 1}]'::jsonb);
    raise exception 'FALLO: se guardó un corte sin su cálculo';
  exception when check_violation then null; end;

  -- 2c.3 Ni sin importe.
  begin
    perform public.crear_cotizacion(900006, 'Prueba SQL Corte',
      '[{"tipo": "corte", "odoo_product_id": 20, "producto_nombre": "X", "cantidad": 1,
         "precio_unitario": 1, "corte": {"version": 1}}]'::jsonb);
    raise exception 'FALLO: se guardó un corte sin importe';
  exception when check_violation then null; end;

  -- 2c.4 Y un producto no puede traer un cálculo de corte colgado.
  begin
    perform public.crear_cotizacion(900006, 'Prueba SQL Corte',
      '[{"odoo_product_id": 10, "producto_nombre": "X", "cantidad": 1,
         "precio_unitario": 1, "corte": {"version": 1}}]'::jsonb);
    raise exception 'FALLO: un producto quedó con un cálculo de corte';
  exception when check_violation then null; end;

  -- 2c.5 Un pedido con un corte y un producto, para lo que sigue.
  id_cot := public.crear_cotizacion(
    p_odoo_partner_id := 900007, p_cliente_nombre := 'Prueba SQL Pedido Corte',
    p_lineas := '[
      {"tipo": "corte", "odoo_product_id": 20, "producto_nombre": "ACRILICO", "cantidad": 3,
       "precio_unitario": 173.33, "importe": 545,
       "corte": {"version": 1, "total": 545, "montoMaterial": 520, "montoServicio": 25,
                 "formato": {"codigo": "F7E024", "precio": 200},
                 "planchas": [{"cobro": {"nombre": "1", "monto": 200}}],
                 "desglose": [{"etiqueta": "Total", "monto": 545}]}},
      {"odoo_product_id": 10, "producto_nombre": "BISAGRA", "cantidad": 4, "precio_unitario": 2.5}
    ]'::jsonb
  );
  -- El código viaja a la sección 3 por un ajuste: el otro rol no lee `cotizaciones`.
  perform set_config('plexi.pedido_corte', public.crear_pedido(
    p_es_provincia := false, p_nombre_cliente := 'Prueba SQL Pedido Corte',
    p_tipos_pedido := array['CL']::public.tipo_pedido[], p_cantidad := 10,
    p_tipo_pago := 'credito', p_lugar_entrega := 'tienda',
    p_fecha_prometida := current_date + 3, p_cotizacion_id := id_cot
  ), true);
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

  -- El taller ve las líneas de un pedido sin un solo precio, y puede anotar planchas.
  declare
    v_codigo text := nullif(current_setting('plexi.pedido_corte', true), '');
    v_corte  jsonb;
  begin
    if v_codigo is null then raise exception 'FALLO: falta el pedido de prueba con corte'; end if;
    select corte into v_corte from public.lineas_de_pedido(v_codigo) where tipo = 'corte';
    if v_corte is null then raise exception 'FALLO: otro rol no ve el corte del pedido'; end if;
    if (v_corte ->> 'total')::numeric <> 0 or (v_corte -> 'formato' ->> 'precio')::numeric <> 0
       or (v_corte -> 'planchas' -> 0 -> 'cobro' ->> 'monto')::numeric <> 0
       or jsonb_array_length(v_corte -> 'desglose') <> 0 then
      raise exception 'FALLO: otro rol ve precios en el corte: %', v_corte;
    end if;
    if exists (select 1 from public.lineas_de_pedido(v_codigo) where importe is not null or precio_unitario is not null) then
      raise exception 'FALLO: otro rol ve el importe de las líneas';
    end if;

    perform public.anotar_planchas_usadas(v_codigo, 1::smallint, 4);
    if (select planchas_usadas from public.lineas_de_pedido(v_codigo) where posicion = 1) <> 4 then
      raise exception 'FALLO: no quedaron anotadas las planchas usadas';
    end if;
    begin
      perform public.anotar_planchas_usadas(v_codigo, 2::smallint, 1);
      raise exception 'FALLO: se anotaron planchas en una línea que no es corte';
    exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

    perform public.anotar_stock_de_pedido(v_codigo, true);
    if not (select stock_descontado from public.odoo_de_pedido(v_codigo)) then
      raise exception 'FALLO: no quedó anotado el stock descontado';
    end if;
    -- Ya descontado, las planchas usadas no se cambian con una anotación.
    begin
      perform public.anotar_planchas_usadas(v_codigo, 1::smallint, 5);
      raise exception 'FALLO: se cambiaron las planchas usadas con el stock ya descontado';
    exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  end;

  begin
    perform public.crear_cotizacion(900003, 'Prueba SQL Intrusa',
      '[{"odoo_product_id": 10, "producto_nombre": "X", "cantidad": 1, "precio_unitario": 1}]'::jsonb);
    raise exception 'FALLO: otro rol pudo crear una cotización';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

select 'cotizaciones: todo en orden' as resultado;

rollback;
