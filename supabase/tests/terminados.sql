-- Verificación de las migraciones 20261113000100–400 (catálogo de productos
-- terminados y la línea de tipo terminado), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/terminados.sql
--
-- Como `cortes.sql`, no necesita las cuentas del seed: entra como el primer
-- usuario activo de Administración que encuentre (y, si hay, como uno de otro
-- rol). Todo dentro de una transacción que termina en ROLLBACK: no deja nada.

begin;

-- ── 1. El esquema y el catálogo sembrado ────────────────────────────────────

do $$
begin
  if exists (
    select 1 from pg_class
     where relname like 'pt\_%' and relkind = 'r'
       and relnamespace = 'public'::regnamespace and not relrowsecurity
  ) then
    raise exception 'FALLO: falta RLS en alguna tabla del catálogo de productos terminados';
  end if;

  if (select count(*) from public.pt_tipos) < 1 or (select count(*) from public.pt_productos) < 1 then
    raise exception 'FALLO: el catálogo de productos terminados está vacío';
  end if;
  if exists (select 1 from public.pt_productos p
              where not exists (select 1 from public.pt_tipos t where t.codigo = p.tipo)) then
    raise exception 'FALLO: hay productos de un tipo que no existe';
  end if;
  -- El código de un producto lleva el prefijo de su tipo.
  if exists (select 1 from public.pt_productos where split_part(codigo, '-', 1) <> tipo) then
    raise exception 'FALLO: hay productos cuyo código no es de su tipo';
  end if;

  if not ('terminado' = any (enum_range(null::public.tipo_linea)::text[])) then
    raise exception 'FALLO: falta el tipo de línea terminado';
  end if;
  if not (array['anforas', 'alzadores', 'tarecos', 'atriles'] <@ enum_range(null::public.producto_terminado)::text[]) then
    raise exception 'FALLO: faltan tipos de producto terminado en la etiqueta del pedido';
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
  id_cot   uuid;
  v_codigo text;
  ficha    jsonb := '{
    "version": 1, "estandar": true, "productoCodigo": "CAJ-001", "tipoCodigo": "CAJ", "tipoNombre": "Caja",
    "nombre": "Caja con tapa removible", "geometria": "caja_cerrada",
    "medidas": {"m1": 30, "m2": 20, "m3": 20}, "medidaEstandar": true,
    "material": {"grupoId": "g", "material": "Acrílico ECO", "color": "Cristal", "espesorMm": 3},
    "opciones": [{"clase": "complemento", "nombre": "Tapa", "extra": 12}],
    "texto": null, "notas": null, "areaUnidadM2": 0.32, "areaManual": false, "mermaPct": 15,
    "materiales": [{"productoId": 20, "codigo": "F7E024", "nombre": "PLANCHA", "unidad": "plancha",
                    "cantidad": 0.33, "precio": 223.26, "esPlancha": true}],
    "costoMaterial": 73.68, "factor": 2, "precioSugerido": 85.68, "precioUnitario": 150, "reservar": true
  }'::jsonb;
  linea    record;
begin
  -- 2.1 El catálogo se edita: un tipo, un producto con su medida y una opción.
  insert into public.pt_tipos (codigo, nombre) values ('PRU', 'Prueba SQL');
  insert into public.pt_productos (codigo, tipo, nombre, geometria) values ('PRU-001', 'PRU', 'Producto de prueba', 'lamina');
  insert into public.pt_medidas (producto, medida_1_cm, medida_2_cm) values ('PRU-001', 20, 30);

  begin
    insert into public.pt_medidas (producto) values ('PRU-001');
    raise exception 'FALLO: se aceptó una medida sin ningún número';
  exception when check_violation then null; end;
  begin
    insert into public.pt_espesores (producto, espesor_min_mm, espesor_max_mm) values ('PRU-001', 5, 3);
    raise exception 'FALLO: se aceptó un espesor máximo menor que el mínimo';
  exception when check_violation then null; end;
  begin
    insert into public.pt_productos (codigo, tipo, nombre) values ('mal', 'PRU', 'Código mal formado');
    raise exception 'FALLO: se aceptó un código de producto mal formado';
  exception when check_violation then null; end;
  begin
    update public.pt_tipos set factor_fabricacion = 0 where codigo = 'PRU';
    raise exception 'FALLO: se aceptó un factor de fabricación de cero';
  exception when check_violation then null; end;

  -- Borrar el producto se lleva lo suyo.
  delete from public.pt_productos where codigo = 'PRU-001';
  if exists (select 1 from public.pt_medidas where producto = 'PRU-001') then
    raise exception 'FALLO: las medidas de un producto borrado se quedaron';
  end if;

  -- 2.2 Una cotización con un producto terminado y un producto suelto.
  id_cot := public.crear_cotizacion(
    p_odoo_partner_id := 990001, p_cliente_nombre := 'Prueba SQL Terminado',
    p_lineas := jsonb_build_array(
      jsonb_build_object(
        'tipo', 'terminado', 'odoo_product_id', 900, 'producto_nombre', 'Caja con tapa removible',
        'producto_codigo', 'CAJ-001', 'descripcion', 'Medidas: 30 × 20 × 20 cm', 'cantidad', 2,
        'precio_unitario', 150, 'importe', 300, 'terminado', ficha
      ),
      jsonb_build_object('odoo_product_id', 10, 'producto_nombre', 'Suelto', 'cantidad', 1, 'precio_unitario', 5)
    )
  );
  select * into linea from public.cotizacion_productos where cotizacion_id = id_cot and posicion = 1;
  if linea.tipo <> 'terminado' or linea.terminado ->> 'productoCodigo' <> 'CAJ-001' or linea.importe <> 300 then
    raise exception 'FALLO: la línea de producto terminado no se guardó con su ficha';
  end if;
  if (select terminado from public.cotizacion_productos where cotizacion_id = id_cot and posicion = 2) is not null then
    raise exception 'FALLO: un producto suelto quedó con ficha de terminado';
  end if;

  -- 2.3 La ficha va con su tipo, y solo con él.
  begin
    perform public.crear_cotizacion(
      p_odoo_partner_id := 990001, p_cliente_nombre := 'Prueba SQL Sin Ficha',
      p_lineas := '[{"tipo": "terminado", "odoo_product_id": 900, "producto_nombre": "Sin ficha", "cantidad": 1, "precio_unitario": 1, "importe": 1}]'::jsonb
    );
    raise exception 'FALLO: se guardó un producto terminado sin ficha';
  exception when check_violation then null; end;
  begin
    perform public.crear_cotizacion(
      p_odoo_partner_id := 990001, p_cliente_nombre := 'Prueba SQL Ficha De Más',
      p_lineas := jsonb_build_array(jsonb_build_object(
        'tipo', 'producto', 'odoo_product_id', 900, 'producto_nombre', 'Con ficha', 'cantidad', 1,
        'precio_unitario', 1, 'terminado', ficha))
    );
    raise exception 'FALLO: un producto suelto se guardó con ficha de terminado';
  exception when check_violation then null; end;
  begin
    perform public.crear_cotizacion(
      p_odoo_partner_id := 990001, p_cliente_nombre := 'Prueba SQL Sin Importe',
      p_lineas := jsonb_build_array(jsonb_build_object(
        'tipo', 'terminado', 'odoo_product_id', 900, 'producto_nombre', 'Sin importe', 'cantidad', 1,
        'precio_unitario', 1, 'terminado', ficha))
    );
    raise exception 'FALLO: se guardó un producto terminado sin importe';
  exception when check_violation then null; end;

  -- 2.4 Sin precios: los montos en cero, lo demás intacto.
  if public.terminado_sin_precios(ficha) ->> 'precioUnitario' <> '0'
     or public.terminado_sin_precios(ficha) ->> 'precioSugerido' <> '0'
     or public.terminado_sin_precios(ficha) #>> '{opciones,0,extra}' <> '0'
     or public.terminado_sin_precios(ficha) #>> '{materiales,0,precio}' <> '0'
     or public.terminado_sin_precios(ficha) #>> '{materiales,0,cantidad}' <> '0.33'
     or public.terminado_sin_precios(ficha) ->> 'nombre' <> 'Caja con tapa removible' then
    raise exception 'FALLO: terminado_sin_precios no deja la ficha como debe';
  end if;

  -- 2.5 El pedido: Administración ve la ficha con sus precios.
  v_codigo := public.crear_pedido(
    p_es_provincia := false, p_nombre_cliente := 'Prueba SQL Terminado',
    p_tipos_pedido := array['PT']::public.tipo_pedido[], p_tipo_producto_terminado := 'anforas',
    p_cantidad := 2, p_tipo_pago := 'credito', p_lugar_entrega := 'tienda',
    p_fecha_prometida := current_date + 3, p_monto_total := 305, p_cotizacion_id := id_cot
  );
  perform set_config('plexi.pedido_terminado', v_codigo, true);
  perform set_config('plexi.cotizacion_terminado', id_cot::text, true);
  select * into linea from public.lineas_de_pedido(v_codigo) where posicion = 1;
  if linea.terminado ->> 'precioUnitario' <> '150' or linea.importe <> 300 or linea.materiales_usados is not null then
    raise exception 'FALLO: Administración no ve el producto terminado del pedido con sus precios';
  end if;

  -- 2.6 Lo usado se anota, se corrige, y solo en una línea de producto terminado.
  perform public.anotar_materiales_de_terminado(v_codigo, 1::smallint,
    '[{"productoId": 20, "codigo": "F7E024", "nombre": "PLANCHA", "unidad": "plancha", "cantidad": 1}]'::jsonb);
  perform public.anotar_materiales_de_terminado(v_codigo, 1::smallint, '[]'::jsonb);
  if (select materiales_usados from public.lineas_de_pedido(v_codigo) where posicion = 1) <> '[]'::jsonb then
    raise exception 'FALLO: los materiales usados no se pudieron corregir';
  end if;
  begin
    perform public.anotar_materiales_de_terminado(v_codigo, 2::smallint, '[]'::jsonb);
    raise exception 'FALLO: se anotaron materiales en una línea que no es un producto terminado';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    perform public.anotar_materiales_de_terminado(v_codigo, 1::smallint, '[{"productoId": 20, "cantidad": -1}]'::jsonb);
    raise exception 'FALLO: se aceptó una cantidad usada negativa';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    perform public.anotar_materiales_de_terminado(v_codigo, 1::smallint, '{"productoId": 20}'::jsonb);
    raise exception 'FALLO: se aceptó algo que no es una lista de materiales';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- 2.7 La orden de fabricación se anota también en un producto terminado.
  perform public.anotar_produccion(id_cot, 1::smallint, 77, 'WH/MO/00077');
  if (select odoo_produccion_nombre from public.lineas_de_pedido(v_codigo) where posicion = 1) <> 'WH/MO/00077' then
    raise exception 'FALLO: la orden de fabricación del producto terminado no quedó anotada';
  end if;
  begin
    perform public.anotar_produccion(id_cot, 2::smallint, 78, 'WH/MO/00078');
    raise exception 'FALLO: se anotó una orden de fabricación en un producto suelto';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- ── 3. Otro rol ─────────────────────────────────────────────────────────────

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

do $$
declare
  v_codigo text := current_setting('plexi.pedido_terminado');
  linea    record;
begin
  if current_setting('plexi.test_otro') = '' then return; end if;

  -- 3.1 El catálogo y sus precios son de Administración.
  if (select count(*) from public.pt_productos) > 0 or (select count(*) from public.pt_opciones) > 0
     or (select count(*) from public.pt_tipos) > 0 then
    raise exception 'FALLO: un rol que no es Administración ve el catálogo de productos terminados';
  end if;
  begin
    insert into public.pt_tipos (codigo, nombre) values ('INT', 'Intruso');
    raise exception 'FALLO: otro rol pudo crear un tipo de producto terminado';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  update public.pt_opciones set extra = 1;
  if found then raise exception 'FALLO: otro rol pudo cambiar el extra de una opción'; end if;

  -- 3.2 Del pedido ve la ficha para fabricarlo, sin dinero.
  select * into linea from public.lineas_de_pedido(v_codigo) where posicion = 1;
  if linea.terminado is null or linea.terminado ->> 'nombre' <> 'Caja con tapa removible' then
    raise exception 'FALLO: otro rol no ve la ficha del producto terminado';
  end if;
  if linea.importe is not null or linea.precio_unitario is not null
     or linea.terminado ->> 'precioUnitario' <> '0' or linea.terminado ->> 'costoMaterial' <> '0'
     or linea.terminado #>> '{materiales,0,precio}' <> '0' then
    raise exception 'FALLO: otro rol ve precios del producto terminado';
  end if;

  -- 3.3 Y anota lo que se usó: es quien termina el pedido.
  perform public.anotar_materiales_de_terminado(v_codigo, 1::smallint,
    '[{"productoId": 20, "codigo": "F7E024", "nombre": "PLANCHA", "unidad": "plancha", "cantidad": 0.5}]'::jsonb);
  if (select materiales_usados #>> '{0,cantidad}' from public.lineas_de_pedido(v_codigo) where posicion = 1) <> '0.5' then
    raise exception 'FALLO: otro rol no pudo anotar los materiales usados';
  end if;

  -- Pero no escribe la línea por su cuenta.
  begin
    update public.cotizacion_productos set materiales_usados = '[]'::jsonb;
    if found then raise exception 'FALLO: otro rol pudo escribir las líneas directamente'; end if;
  exception when insufficient_privilege then null; end;
end $$;

-- 3.4 Con el stock ya descontado, lo usado no se corrige.
set local role postgres;
update public.cotizaciones set stock_descontado = true where id = current_setting('plexi.cotizacion_terminado')::uuid;
set local role authenticated;

do $$
begin
  perform public.anotar_materiales_de_terminado(current_setting('plexi.pedido_terminado'), 1::smallint, '[]'::jsonb);
  raise exception 'FALLO: se corrigieron materiales con el stock ya descontado';
exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end $$;

set local role postgres;

select 'terminados: todo en orden' as resultado;

rollback;
