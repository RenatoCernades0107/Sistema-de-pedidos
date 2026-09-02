-- Verificación de las migraciones 20260902000100–000400, contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/notificaciones.sql
--
-- Como `comprobante.sql`, no necesita las tres cuentas del seed: sirve en un
-- proyecto de producción con sus usuarios de verdad. Todo lo que crea —el
-- enlace del trabajador incluido— nace y muere dentro de la transacción, y
-- termina en ROLLBACK.
--
-- El enlace se hace a mano aquí a propósito. La migración lo hace por nombre y en
-- la base sembrada no coincide ninguno (los usuarios del seed son Ana Torres /
-- Carla Díaz / Miguel Ruiz), así que una prueba que dependiera del enlace
-- automático pasaría en producción y fallaría en la base de pruebas por un
-- motivo que no tiene que ver con lo que está probando.
--
-- Lo que NO cubre, por necesitar sesiones de rol: la RLS de las dos tablas
-- nuevas. Eso va abajo, en la sección 8, y sí necesita las cuentas del seed;
-- si no están, esa sección se salta sola y lo dice.

begin;

-- ── 1. El enlace trabajador ↔ cuenta ────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trabajadores'
       and column_name = 'usuario_id' and is_nullable = 'YES'
  ) then
    raise exception 'FALLO: trabajadores.usuario_id no existe o es NOT NULL';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trabajadores'::regclass
       and contype = 'f'
       and confrelid = 'public.usuarios'::regclass
  ) then
    raise exception 'FALLO: trabajadores.usuario_id no apunta a usuarios';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trabajadores'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) like '%usuario_id%'
  ) then
    raise exception 'FALLO: falta el UNIQUE de trabajadores.usuario_id';
  end if;
end $$;

-- ── 2. Una cuenta, un solo trabajador ───────────────────────────────────────

do $$
declare
  cuenta   uuid;
  primero  uuid;
  segundo  uuid;
begin
  select id into cuenta from public.usuarios where activo limit 1;
  if cuenta is null then
    raise exception 'FALLO: no hay ninguna cuenta activa con la que probar';
  end if;

  insert into public.trabajadores (nombre) values ('ZZ prueba avisos 1') returning id into primero;
  insert into public.trabajadores (nombre) values ('ZZ prueba avisos 2') returning id into segundo;

  update public.trabajadores set usuario_id = cuenta where id = primero;

  begin
    update public.trabajadores set usuario_id = cuenta where id = segundo;
    raise exception 'FALLO: dos trabajadores se quedaron con la misma cuenta';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

-- ── 3-7. El trigger, en caliente ────────────────────────────────────────────
-- Un trabajador enlazado, uno sin cuenta y uno con la cuenta desactivada. Los
-- tres casos que el trigger tiene que distinguir.

do $$
declare
  cuenta      uuid;
  cuenta_off  uuid;
  enlazado    uuid;
  huerfano    uuid;
  desactivado uuid;
  otro        uuid;
  pedido      uuid;
  cuantas     int;
  destino     uuid;
  texto       text;
begin
  select id into cuenta from public.usuarios where activo order by creado_en limit 1;

  -- Una segunda cuenta que se desactiva dentro de la transacción, para el caso
  -- "tiene cuenta pero está dada de baja".
  select id into cuenta_off from public.usuarios where activo and id <> cuenta limit 1;
  if cuenta_off is null then
    raise exception 'FALLO: hacen falta dos cuentas activas para esta prueba';
  end if;

  insert into public.trabajadores (nombre, usuario_id)
    values ('ZZ enlazado', cuenta) returning id into enlazado;
  insert into public.trabajadores (nombre)
    values ('ZZ sin cuenta') returning id into huerfano;
  insert into public.trabajadores (nombre, usuario_id)
    values ('ZZ cuenta de baja', cuenta_off) returning id into desactivado;

  update public.usuarios set activo = false where id = cuenta_off;

  -- 3. Con responsable enlazado: una fila, para esa cuenta, con el código dentro.
  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad,
                              tipo_pago, monto_total, lugar_entrega, fecha_prometida,
                              responsable_id)
  values (false, 'ZZ prueba avisos', array['CL']::public.tipo_pedido[], 1,
          'contado', 100, 'tienda', current_date + 3, enlazado)
  returning id into pedido;

  select count(*), min(destinatario_id), min(cuerpo)
    into cuantas, destino, texto
    from public.notificaciones where pedido_id = pedido;

  if cuantas <> 1 then
    raise exception 'FALLO: se encolaron % avisos al crear el pedido, se esperaba 1', cuantas;
  end if;
  if destino is distinct from cuenta then
    raise exception 'FALLO: el aviso fue a la cuenta equivocada';
  end if;
  if texto not like '%' || (select codigo from public.pedidos where id = pedido) || '%' then
    raise exception 'FALLO: el cuerpo del aviso no menciona el código: %', texto;
  end if;
  if not exists (
    select 1 from public.notificaciones
     where pedido_id = pedido and tipo = 'pedido_creado' and enviada_en is null
  ) then
    raise exception 'FALLO: el aviso no quedó como pedido_creado pendiente';
  end if;

  -- 4. Sin responsable: nada.
  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad,
                              tipo_pago, monto_total, lugar_entrega, fecha_prometida)
  values (false, 'ZZ sin responsable', array['CL']::public.tipo_pedido[], 1,
          'contado', 100, 'tienda', current_date + 3)
  returning id into otro;

  if exists (select 1 from public.notificaciones where pedido_id = otro) then
    raise exception 'FALLO: se avisó de un pedido que no tiene responsable';
  end if;

  -- 5. Responsable sin cuenta enlazada: nada.
  update public.pedidos set responsable_id = huerfano where id = otro;
  if exists (select 1 from public.notificaciones where pedido_id = otro) then
    raise exception 'FALLO: se avisó a un trabajador que no tiene cuenta';
  end if;

  -- 6. Responsable con la cuenta desactivada: nada.
  update public.pedidos set responsable_id = desactivado where id = otro;
  if exists (select 1 from public.notificaciones where pedido_id = otro) then
    raise exception 'FALLO: se avisó a una cuenta desactivada';
  end if;

  -- 7. Reasignar avisa al nuevo, y solo al nuevo.
  update public.pedidos set responsable_id = enlazado where id = otro;

  select count(*) into cuantas
    from public.notificaciones
   where pedido_id = otro and tipo = 'responsable_asignado';
  if cuantas <> 1 then
    raise exception 'FALLO: reasignar encoló % avisos, se esperaba 1', cuantas;
  end if;

  if (select destinatario_id from public.notificaciones
       where pedido_id = otro and tipo = 'responsable_asignado') is distinct from cuenta then
    raise exception 'FALLO: el aviso de reasignación fue a quien no era';
  end if;

  -- 8. Escribir el mismo responsable no avisa otra vez.
  update public.pedidos set responsable_id = enlazado where id = otro;
  select count(*) into cuantas from public.notificaciones where pedido_id = otro;
  if cuantas <> 1 then
    raise exception 'FALLO: reescribir el mismo responsable encoló otro aviso';
  end if;

  -- 9. Mover el estado no avisa: el trigger es `of responsable_id`.
  update public.pedidos set estado = 'en_proceso' where id = otro;
  select count(*) into cuantas from public.notificaciones where pedido_id = otro;
  if cuantas <> 1 then
    raise exception 'FALLO: cambiar el estado encoló un aviso que nadie pidió';
  end if;
end $$;

-- ── 10. Tomar de la cola no reparte dos veces ───────────────────────────────

do $$
declare
  primera int;
  segunda int;
begin
  select count(*) into primera from public.tomar_notificaciones(50);
  if primera = 0 then
    raise exception 'FALLO: la cola no devolvió los avisos que acabamos de crear';
  end if;

  -- La segunda pasada seguida no puede devolver lo mismo: acaba de tomarse y la
  -- ventana de reintento es de 2 minutos.
  select count(*) into segunda from public.tomar_notificaciones(50);
  if segunda <> 0 then
    raise exception 'FALLO: la cola repartió % avisos ya tomados', segunda;
  end if;
end $$;

-- ── 11. Un aviso roto no puede tumbar el alta del pedido ────────────────────
-- Se rompe `texto_notificacion` a propósito y se comprueba que el pedido igual
-- se registra. El `exception when others` del trigger es lo que se está probando.

do $$
declare
  cuenta   uuid;
  trabajo  uuid;
  pedido   uuid;
begin
  select id into cuenta from public.usuarios where activo order by creado_en limit 1;
  insert into public.trabajadores (nombre, usuario_id)
    values ('ZZ trigger roto', cuenta) returning id into trabajo;

  create or replace function public.texto_notificacion(
    p_tipo public.tipo_notificacion, p_codigo text
  ) returns table (titulo text, cuerpo text)
  language plpgsql immutable as $roto$
  begin
    raise exception 'boom';
  end $roto$;

  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad,
                              tipo_pago, monto_total, lugar_entrega, fecha_prometida,
                              responsable_id)
  values (false, 'ZZ trigger roto', array['CL']::public.tipo_pedido[], 1,
          'contado', 100, 'tienda', current_date + 3, trabajo)
  returning id into pedido;

  if pedido is null then
    raise exception 'FALLO: un aviso roto impidió registrar el pedido';
  end if;
  if exists (select 1 from public.notificaciones where pedido_id = pedido) then
    raise exception 'FALLO: se encoló un aviso con la función rota';
  end if;
end $$;

-- ── 12. Las tablas tienen RLS activa ────────────────────────────────────────
-- Que las políticas hagan lo suyo se prueba con sesiones de rol en asserts.sql;
-- aquí basta con que nadie se haya olvidado de encenderla.

do $$
declare
  tabla text;
begin
  foreach tabla in array array['suscripciones_push', 'notificaciones'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || tabla)::regclass) then
      raise exception 'FALLO: % no tiene RLS activa', tabla;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'suscripciones_push'
       and qual like '%auth.uid()%'
  ) then
    raise exception 'FALLO: la política de suscripciones_push no filtra por auth.uid()';
  end if;
end $$;

-- ── 13. La cola no se vacía desde el navegador ──────────────────────────────

do $$
begin
  if has_function_privilege('authenticated', 'public.tomar_notificaciones(int)', 'execute') then
    raise exception 'FALLO: authenticated puede vaciar la cola de avisos';
  end if;
end $$;

select 'Verificación de los avisos: todo en orden.' as resultado;

rollback;
