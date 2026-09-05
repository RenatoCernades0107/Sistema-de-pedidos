-- Verificación del esquema. Se ejecuta contra el proyecto ya migrado y sembrado.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/asserts.sql
--
-- Todo ocurre dentro de una transacción que termina en ROLLBACK: es una base
-- cloud, y una prueba no puede dejar pedidos de mentira en producción.
-- Si algo no cumple, psql aborta con el mensaje del RAISE.

begin;

-- Los tres usuarios del seed, uno por rol. Sin ellos no se pueden probar los
-- permisos: las secciones 8.x entran como cada uno para ver qué le deja hacer.
--
-- Se comprueban por nombre y no contando el dominio: `usuarios_iniciales.sql`
-- da de alta las cuentas reales en ese mismo `@plexiacril.test`, así que un
-- conteo daba 10 en el proyecto de producción y abortaba aquí sin explicar por
-- qué. Estas pruebas necesitan una base sembrada, no una en uso.
do $$
declare
  faltan text;
begin
  select string_agg(e, ', ')
    into faltan
    from unnest(array['ana@plexiacril.test',
                      'carla@plexiacril.test',
                      'miguel@plexiacril.test']) as e
   where not exists (select 1 from public.usuarios where email = e);

  if faltan is not null then
    raise exception 'Faltan cuentas del seed (%). Estas pruebas van contra una base sembrada; para verificar solo la migración del comprobante usa supabase/tests/comprobante.sql', faltan;
  end if;
end $$;

-- ── 1. Código del pedido ────────────────────────────────────────────────────

do $$
declare
  local_cl text;
  provincia_mx text;
begin
  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                              monto_total, lugar_entrega, fecha_prometida)
  values (false, 'Prueba local', array['CL']::public.tipo_pedido[], 3, 'contado', 100, 'tienda', current_date + 3)
  returning codigo into local_cl;

  if local_cl !~ '^LCL_[0-9]{4}_[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'Código local mal formado: %', local_cl;
  end if;

  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                              monto_total, lugar_entrega, fecha_prometida)
  values (true, 'Prueba provincia', array['CL', 'AC']::public.tipo_pedido[], 2, 'contado', 100, 'agencia', current_date + 3)
  returning codigo into provincia_mx;

  -- Varios tipos en un pedido se dictan como MX; el desglose vive en la columna.
  if provincia_mx !~ '^PMX_' then
    raise exception 'Un pedido de varios tipos a provincia debería empezar en PMX_, y es %', provincia_mx;
  end if;
end $$;

-- ── 2. Inmutabilidad ────────────────────────────────────────────────────────

do $$
begin
  begin
    update public.pedidos set codigo = 'LCL_2026_AAAA' where nombre_cliente = 'Prueba local';
    raise exception 'FALLO: se pudo cambiar el código del pedido';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;

  begin
    update public.pedidos set es_provincia = true where nombre_cliente = 'Prueba local';
    raise exception 'FALLO: se pudo cambiar es_provincia';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;
end $$;

-- ── 3. Reglas de datos ──────────────────────────────────────────────────────

do $$
declare
  base_provincia smallint := (select pr.id from public.provincias pr
                              join public.departamentos d on d.id = pr.departamento_id
                              where d.nombre = 'Cusco' and pr.nombre = 'Urubamba');
  depto_piura smallint := (select id from public.departamentos where nombre = 'Piura');
  pedido uuid;
begin
  -- Productos terminados exige el tipo de producto, y solo ellos lo admiten.
  begin
    insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                                monto_total, lugar_entrega, fecha_prometida)
    values (false, 'PT sin producto', array['PT']::public.tipo_pedido[], 1, 'contado', 10, 'tienda', current_date);
    raise exception 'FALLO: un pedido PT pasó sin tipo_producto_terminado';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, tipo_producto_terminado,
                                cantidad, tipo_pago, monto_total, lugar_entrega, fecha_prometida)
    values (false, 'CL con producto', array['CL']::public.tipo_pedido[], 'cajas', 1, 'contado', 10, 'tienda', current_date);
    raise exception 'FALLO: un pedido de corte láser aceptó tipo_producto_terminado';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Media plancha se corta; media caja no existe.
  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                              monto_total, lugar_entrega, fecha_prometida)
  values (false, 'Media plancha', array['SP']::public.tipo_pedido[], 2.5, 'contado', 10, 'tienda', current_date);

  begin
    insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                                monto_total, lugar_entrega, fecha_prometida)
    values (false, 'Medio corte', array['CL']::public.tipo_pedido[], 2.5, 'contado', 10, 'tienda', current_date);
    raise exception 'FALLO: se aceptaron 2.5 unidades en un pedido sin planchas';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- El plazo solo existe mientras el pedido sea al crédito.
  begin
    insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                                plazo_credito_dias, monto_total, lugar_entrega, fecha_prometida)
    values (false, 'Contado con plazo', array['CL']::public.tipo_pedido[], 1, 'contado', 15, 10, 'tienda', current_date);
    raise exception 'FALLO: un pedido al contado aceptó plazo de crédito';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                              plazo_credito_dias, monto_total, lugar_entrega, fecha_prometida)
  values (false, 'Crédito a 15', array['CL']::public.tipo_pedido[], 1, 'credito', 15, 10, 'tienda', current_date);

  -- A domicilio sin dirección no se puede entregar.
  begin
    insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                                monto_total, lugar_entrega, fecha_prometida)
    values (false, 'Sin dirección', array['CL']::public.tipo_pedido[], 1, 'contado', 10, 'domicilio', current_date);
    raise exception 'FALLO: se aceptó una entrega a domicilio sin dirección';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Provincia y agencia van juntas o no van.
  begin
    insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                                monto_total, lugar_entrega, fecha_prometida)
    values (true, 'Provincia en tienda', array['CL']::public.tipo_pedido[], 1, 'contado', 10, 'tienda', current_date);
    raise exception 'FALLO: un pedido a provincia se entregaba en tienda';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Una provincia del Cusco no cuelga de Piura.
  select id into pedido from public.pedidos where nombre_cliente = 'Prueba provincia';
  begin
    insert into public.envios_provincia (pedido_id, departamento_id, provincia_id)
    values (pedido, depto_piura, base_provincia);
    raise exception 'FALLO: se aceptó una provincia que no pertenece al departamento';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  insert into public.envios_provincia (pedido_id, departamento_id, provincia_id, tipo_documento, numero_documento)
  values (pedido, (select departamento_id from public.provincias where id = base_provincia), base_provincia, 'DNI', '44821903');

  begin
    update public.envios_provincia set numero_documento = '123' where pedido_id = pedido;
    raise exception 'FALLO: se aceptó un DNI de 3 dígitos';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- ── 3b. Formato del comprobante ─────────────────────────────────────────────
-- `pedidos_comprobante_formato` acepta factura (F), boleta (B), proforma (P) y nota
-- de venta (NV), serie de 3 dígitos y correlativo de hasta 8. Hasta la migración
-- 20260901000800 el patrón vivía solo en Zod, así que cualquier insert por SQL
-- entraba sin mirar.
--
-- Va antes de la máquina de estados a propósito: ahí 'Prueba local' sigue en
-- `registrado`, así que el comprobante puede volver a null al terminar. Después de
-- la sección 4 el pedido está entregado y `pedidos_comprobante_al_entregar` lo
-- impediría.

do $$
declare
  pedido uuid := (select id from public.pedidos where nombre_cliente = 'Prueba local');
  valor  text;
begin
  foreach valor in array array[
    'F001-004512', 'B001-000318', 'F010-1', 'B999-00004512',
    'P001-004512', 'NV001-004512', 'NV010-1'
  ] loop
    begin
      update public.pedidos set numero_comprobante = valor where id = pedido;
    exception when others then
      raise exception 'FALLO: se rechazó el comprobante válido %', valor;
    end;
  end loop;

  foreach valor in array array[
    'FF01-004512',      -- serie con letra
    'X001-004512',      -- ni factura, boleta, proforma ni nota de venta
    'f001-004512',      -- minúscula
    'F001-000045123',   -- correlativo de 9
    'F001-',            -- sin correlativo
    'F0011-004512',     -- serie de 4
    'N001-004512',      -- 'N' sola no es nota de venta
    'NV0011-004512'     -- serie de 4 en nota de venta
  ] loop
    begin
      update public.pedidos set numero_comprobante = valor where id = pedido;
      raise exception 'FALLO: se aceptó el comprobante inválido %', valor;
    exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  end loop;

  -- Se devuelve a null: la sección 4 cuenta con que el pedido no tiene comprobante.
  update public.pedidos set numero_comprobante = null where id = pedido;
end $$;

-- ── 4. Máquina de estados ───────────────────────────────────────────────────

do $$
declare
  local_id     uuid := (select id from public.pedidos where nombre_cliente = 'Prueba local');
  provincia_id uuid := (select id from public.pedidos where nombre_cliente = 'Prueba provincia');
  fila         public.pedidos;
begin
  begin
    update public.pedidos set estado = 'entregado', numero_comprobante = 'F001-1' where id = local_id;
    raise exception 'FALLO: se saltó de registrado a entregado';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  update public.pedidos set estado = 'en_proceso' where id = local_id;
  update public.pedidos set estado = 'listo'      where id = local_id;

  begin
    update public.pedidos set estado = 'en_transito' where id = local_id;
    raise exception 'FALLO: un pedido local pasó a en tránsito';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    update public.pedidos set estado = 'entregado' where id = local_id;
    raise exception 'FALLO: se entregó un pedido sin comprobante';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  update public.pedidos set estado = 'entregado', numero_comprobante = 'F001-000999' where id = local_id;
  select * into fila from public.pedidos where id = local_id;

  if fila.fecha_entrega is distinct from current_date then
    raise exception 'La fecha de entrega no se llenó sola: %', fila.fecha_entrega;
  end if;
  if fila.fecha_anulacion is not null then
    raise exception 'Un pedido entregado no puede tener fecha de anulación';
  end if;

  begin
    update public.pedidos set estado = 'listo' where id = local_id;
    raise exception 'FALLO: se salió del estado entregado';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Anular exige explicación.
  begin
    update public.pedidos set estado = 'anulado' where id = provincia_id;
    raise exception 'FALLO: se anuló un pedido sin motivo';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  update public.pedidos set estado = 'anulado', motivo = 'El cliente desistió' where id = provincia_id;
  select * into fila from public.pedidos where id = provincia_id;

  if fila.fecha_anulacion is distinct from current_date or fila.fecha_entrega is not null then
    raise exception 'Al anular deben quedar fecha_anulacion = hoy y fecha_entrega nula';
  end if;
end $$;

-- ── 5. Dinero ───────────────────────────────────────────────────────────────

do $$
declare
  pedido uuid;
  fila   public.pedidos;
  abono  uuid;
begin
  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad, tipo_pago,
                              monto_total, lugar_entrega, fecha_prometida)
  values (false, 'Prueba saldo', array['CL']::public.tipo_pedido[], 1, 'a_cuenta', 120, 'tienda', current_date)
  returning id into pedido;

  insert into public.pagos (pedido_id, monto, metodo) values (pedido, 50, 'efectivo') returning id into abono;
  insert into public.pagos (pedido_id, monto, metodo) values (pedido, 50, 'yape_plin');

  select * into fila from public.pedidos where id = pedido;
  if fila.saldo <> 20 or fila.pagado then
    raise exception 'Con 100 de 120 el saldo debería ser 20 y pagado false; son % y %', fila.saldo, fila.pagado;
  end if;

  insert into public.pagos (pedido_id, monto, metodo) values (pedido, 20, 'transferencia');
  select * into fila from public.pedidos where id = pedido;
  if fila.saldo <> 0 or not fila.pagado then
    raise exception 'Completado el total, pagado debería ser true';
  end if;

  -- Recalcula, no acumula: borrar un abono baja el total pagado.
  delete from public.pagos where id = abono;
  select * into fila from public.pedidos where id = pedido;
  if fila.monto_pagado <> 70 then
    raise exception 'Tras borrar un abono de 50, el pagado debería ser 70 y es %', fila.monto_pagado;
  end if;
end $$;

-- ── 6. Auditoría e historial ────────────────────────────────────────────────

do $$
declare
  pedido uuid := (select id from public.pedidos where nombre_cliente = 'Prueba saldo');
  n      integer;
  log    public.logs_auditoria;
begin
  update public.pedidos set nombre_cliente = 'Prueba saldo corregida' where id = pedido;

  select count(*) into n from public.logs_auditoria
  where pedido_id = pedido and campo = 'nombre_cliente';
  if n <> 1 then
    raise exception 'Editar el cliente debería dejar 1 fila de auditoría, dejó %', n;
  end if;

  -- El log se lee sin diccionario: nombres, no uuids ni siglas.
  update public.pedidos
  set responsable_id = (select id from public.trabajadores where nombre = 'Angel')
  where id = pedido;

  select * into log from public.logs_auditoria
  where pedido_id = pedido and campo = 'responsable_id' order by creado_en desc limit 1;
  if log.valor_nuevo <> 'Angel' then
    raise exception 'La auditoría del responsable debería decir "Angel" y dice "%"', log.valor_nuevo;
  end if;

  update public.pedidos set tipos_pedido = array['CL', 'AC']::public.tipo_pedido[] where id = pedido;
  select * into log from public.logs_auditoria
  where pedido_id = pedido and campo = 'tipos_pedido' order by creado_en desc limit 1;
  if log.valor_nuevo <> 'Corte láser · Accesorio' then
    raise exception 'La auditoría de tipos debería decir "Corte láser · Accesorio" y dice "%"', log.valor_nuevo;
  end if;

  -- Un pedido que nace ya tiene su primera fila de historial.
  select count(*) into n from public.historial_estados where pedido_id = pedido;
  if n < 1 then
    raise exception 'El pedido no registró su estado inicial en el historial';
  end if;
end $$;

-- ── 7. Permisos por rol ─────────────────────────────────────────────────────
-- Se simula la sesión de cada usuario: rol Postgres `authenticated` y el claim
-- `sub` que lee auth.uid(), exactamente como llega desde PostgREST.

-- El id del pedido de prueba viaja en un GUC: dentro de la sesión de Operaciones
-- no se puede buscar por `nombre_cliente`, que es justo la columna que no ve.
select set_config('plexi.test_pedido',
                  (select id::text from public.pedidos where nombre_cliente = 'Prueba saldo corregida'),
                  true);

select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where email = 'miguel@plexiacril.test'),
                                    'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  pedido uuid := current_setting('plexi.test_pedido')::uuid;
begin
  -- El taller produce sin saber de quién es el pedido.
  begin
    execute 'select nombre_cliente from public.pedidos limit 1';
    raise exception 'FALLO: Operaciones pudo leer nombre_cliente de la tabla';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    execute 'select monto_total from public.pedidos limit 1';
    raise exception 'FALLO: Operaciones pudo leer monto_total de la tabla';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- La vista de Administración existe para todos, pero para el taller está vacía.
  if (select count(*) from public.pedidos_admin) <> 0 then
    raise exception 'FALLO: Operaciones vio filas en la vista de Administración';
  end if;

  -- Su vista, en cambio, tiene los pedidos.
  if (select count(*) from public.pedidos_operaciones) = 0 then
    raise exception 'Operaciones no ve ningún pedido en su vista';
  end if;

  begin
    execute format('update public.pedidos set ubicacion_actual = ''tienda'' where id = %L', pedido);
    raise exception 'FALLO: Operaciones cambió la ubicación del pedido';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    execute format('update public.pedidos set responsable_id = null where id = %L', pedido);
    raise exception 'FALLO: Operaciones reasignó el responsable';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Lo único que sí puede: mover el estado.
  execute format('update public.pedidos set estado = ''en_proceso'' where id = %L', pedido);

  begin
    execute 'delete from public.logs_auditoria';
    raise exception 'FALLO: se pudo borrar la auditoría';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    execute 'update public.logs_auditoria set valor_nuevo = ''otro''';
    raise exception 'FALLO: se pudo editar la auditoría';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- La sesión del CLI entra como cli_login_postgres: un RESET volvería a ese rol,
-- no al dueño de las tablas.
set local role postgres;

-- Logística: ve al cliente y mueve la caja, pero no ve el dinero.
select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where email = 'carla@plexiacril.test'),
                                    'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  pedido uuid := current_setting('plexi.test_pedido')::uuid;
begin
  if (select count(*) from public.pedidos_logistica) = 0 then
    raise exception 'Logística no ve ningún pedido en su vista';
  end if;

  begin
    execute 'select monto_total from public.pedidos limit 1';
    raise exception 'FALLO: Logística pudo leer monto_total';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  execute format('update public.pedidos set ubicacion_actual = ''tienda'' where id = %L', pedido);

  begin
    execute format('update public.pedidos set monto_total = 1 where id = %L', pedido);
    raise exception 'FALLO: Logística cambió el monto del pedido';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- La sesión del CLI entra como cli_login_postgres: un RESET volvería a ese rol,
-- no al dueño de las tablas.
set local role postgres;

-- ── 8. Escrituras de la Fase 4 ──────────────────────────────────────────────
-- Lo que la app hace ahora de verdad: registrar, cobrar y mover pedidos con la
-- sesión de quien pide el cambio. Todo lo de aquí abajo corre como `authenticated`
-- con el claim `sub` de un usuario real, que es como llega desde PostgREST.

select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where email = 'ana@plexiacril.test'),
                                    'role', 'authenticated')::text,
                  true);
set local role authenticated;

-- 8.1 El alta completa en una sola llamada: pedido, envío y abono inicial.
do $$
declare
  nuevo   text;
  destino smallint;
  prov    smallint;
  pedido  uuid;
begin
  select id into destino from public.departamentos where nombre = 'La Libertad';
  select id into prov    from public.provincias where departamento_id = destino and nombre = 'Trujillo';

  nuevo := public.crear_pedido(
    p_es_provincia    => true,
    p_nombre_cliente  => 'Prueba alta atómica',
    p_tipos_pedido    => array['CL', 'AC']::public.tipo_pedido[],
    p_cantidad        => 2,
    p_tipo_pago       => 'a_cuenta',
    p_lugar_entrega   => 'agencia',
    p_fecha_prometida => current_date + 5,
    p_monto_total     => 200,
    p_departamento_id => destino,
    p_provincia_id    => prov,
    p_abono_inicial   => 50,
    p_metodo_pago     => 'yape_plin'
  );
  perform set_config('plexi.test_alta', nuevo, true);

  -- Dos tipos y destino provincia: el código tiene que abrir por PMX.
  if nuevo !~ '^PMX_[0-9]{4}_' then
    raise exception 'FALLO: el código del pedido combinado a provincia no es PMX: %', nuevo;
  end if;

  select id into pedido from public.pedidos where codigo = nuevo;

  if not exists (select 1 from public.envios_provincia where pedido_id = pedido) then
    raise exception 'FALLO: el pedido a provincia se creó sin su fila de envío';
  end if;
  if (select count(*) from public.pagos where pedido_id = pedido) <> 1 then
    raise exception 'FALLO: el abono inicial no quedó registrado';
  end if;
  if (select saldo from public.pedidos_admin where id = pedido) <> 150 then
    raise exception 'FALLO: el saldo tras el abono inicial no es 150';
  end if;
  -- El pedido nace ya firmado por quien lo registró.
  if (select count(*) from public.historial_pedido where pedido_id = pedido and usuario is not null) = 0 then
    raise exception 'FALLO: el historial del pedido nuevo no dice quién lo creó';
  end if;
end $$;

-- 8.2 Un abono que pasa del total. No falla en `pagos`: falla en `pedidos`, dentro
-- del trigger que recalcula el saldo. Es el error que la app tiene que traducir.
do $$
declare
  pedido uuid := (select id from public.pedidos where codigo = current_setting('plexi.test_alta'));
begin
  begin
    insert into public.pagos (pedido_id, monto, metodo) values (pedido, 1000, 'efectivo');
    raise exception 'FALLO: se registró un abono que supera el monto total';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- 8.3 `INSERT ... RETURNING` de una columna sin GRANT SELECT: falla incluso para
-- Administración, porque el privilegio de columna no distingue roles de la app.
do $$
begin
  begin
    execute $q$
      insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad,
                                  tipo_pago, lugar_entrega, fecha_prometida)
      values (false, 'Prueba returning', array['CL']::public.tipo_pedido[], 1,
              'contado', 'tienda', current_date + 1)
      returning nombre_cliente
    $q$;
    raise exception 'FALLO: se pudo devolver nombre_cliente en un INSERT';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- 8.4 Las vistas de rol son de solo lectura: toda escritura va a las tablas base.
do $$
begin
  begin
    execute 'update public.pedidos_admin set estado = ''listo''';
    raise exception 'FALLO: se pudo escribir sobre una vista de rol';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- 8.5 Datos de envío colgados de un pedido que no va a provincia.
do $$
declare
  local_codigo text;
  pedido       uuid;
  destino      smallint := (select id from public.departamentos where nombre = 'Lima');
begin
  local_codigo := public.crear_pedido(
    p_es_provincia    => false,
    p_nombre_cliente  => 'Prueba local sin envío',
    p_tipos_pedido    => array['CL']::public.tipo_pedido[],
    p_cantidad        => 1,
    p_tipo_pago       => 'contado',
    p_lugar_entrega   => 'tienda',
    p_fecha_prometida => current_date + 2,
    p_monto_total     => 80
  );
  perform set_config('plexi.test_local', local_codigo, true);
  select id into pedido from public.pedidos where codigo = local_codigo;

  begin
    insert into public.envios_provincia (pedido_id, departamento_id) values (pedido, destino);
    raise exception 'FALLO: un pedido local aceptó datos de envío a provincia';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Se deja listo y sin comprobante para la prueba de Logística de 8.8.
  update public.pedidos set estado = 'en_proceso' where id = pedido;
  update public.pedidos set estado = 'listo'      where id = pedido;
end $$;

-- 8.6 `tiene_comprobante` está en las tres vistas; el número, solo en la de Administración.
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and column_name = 'tiene_comprobante'
        and table_name in ('pedidos_operaciones', 'pedidos_logistica', 'pedidos_admin')) <> 3 then
    raise exception 'FALLO: tiene_comprobante no está en las tres vistas de rol';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and column_name = 'numero_comprobante'
               and table_name in ('pedidos_operaciones', 'pedidos_logistica')) then
    raise exception 'FALLO: el comprobante se filtró a una vista que no debe verlo';
  end if;
end $$;

set local role postgres;

-- 8.7 Registrar pedidos es solo de Administración. La política `pedidos_crear` lo
-- corta aunque la llamada entre por la función.
select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where email = 'miguel@plexiacril.test'),
                                    'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
begin
  begin
    perform public.crear_pedido(
      p_es_provincia    => false,
      p_nombre_cliente  => 'Prueba operaciones',
      p_tipos_pedido    => array['CL']::public.tipo_pedido[],
      p_cantidad        => 1,
      p_tipo_pago       => 'contado',
      p_lugar_entrega   => 'tienda',
      p_fecha_prometida => current_date + 1
    );
    raise exception 'FALLO: Operaciones registró un pedido';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Y el taller sí ve si el pedido ya tiene comprobante, sin ver el número.
  if (select count(*) from public.pedidos_operaciones where tiene_comprobante is not null) = 0 then
    raise exception 'FALLO: Operaciones no puede leer tiene_comprobante';
  end if;
end $$;

set local role postgres;

-- 8.8 Logística tampoco crea pedidos, y no puede cerrar uno sin comprobante: no lo
-- escribe (no está en sus columnas permitidas) y el CHECK lo exige para entregar.
select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where email = 'carla@plexiacril.test'),
                                    'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  pedido uuid := (select id from public.pedidos where codigo = current_setting('plexi.test_local'));
begin
  begin
    perform public.crear_pedido(
      p_es_provincia    => false,
      p_nombre_cliente  => 'Prueba logística',
      p_tipos_pedido    => array['CL']::public.tipo_pedido[],
      p_cantidad        => 1,
      p_tipo_pago       => 'contado',
      p_lugar_entrega   => 'tienda',
      p_fecha_prometida => current_date + 1
    );
    raise exception 'FALLO: Logística registró un pedido';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    execute format('update public.pedidos set estado = ''entregado'' where id = %L', pedido);
    raise exception 'FALLO: Logística entregó un pedido sin comprobante';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    execute format(
      'update public.pedidos set estado = ''entregado'', numero_comprobante = ''F001-000001'' where id = %L',
      pedido);
    raise exception 'FALLO: Logística escribió el comprobante';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

-- 8.9 Administración sí cierra ese mismo pedido, con su comprobante y en un solo
-- UPDATE: el CHECK mira la fila entera, así que en dos sentencias fallaría.
select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where email = 'ana@plexiacril.test'),
                                    'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  pedido uuid := (select id from public.pedidos where codigo = current_setting('plexi.test_local'));
begin
  update public.pedidos
  set estado = 'entregado', numero_comprobante = 'F001-000001'
  where id = pedido;

  if (select fecha_entrega from public.pedidos_operaciones where id = pedido) is distinct from current_date then
    raise exception 'FALLO: la fecha de entrega no se llenó sola';
  end if;
  if not (select tiene_comprobante from public.pedidos_operaciones where id = pedido) then
    raise exception 'FALLO: tiene_comprobante sigue en falso después de registrar el comprobante';
  end if;
end $$;

set local role postgres;

-- Si se llegó hasta aquí, todo pasó: cualquier fallo aborta antes con su RAISE.
rollback;
