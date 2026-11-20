-- Verificación de la migración 20261129000100 (el chat del equipo).
--
--   npx supabase db query --linked -f supabase/tests/chat.sql
--
-- No necesita las cuentas del seed: crea tres personas de prueba (una por rol)
-- dentro de una transacción que termina en ROLLBACK, así que no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from pg_class
     where relname in ('conversaciones', 'conversacion_miembros', 'mensajes', 'mensaje_adjuntos', 'mensaje_lecturas')
       and relnamespace = 'public'::regnamespace and not relrowsecurity
  ) then
    raise exception 'FALLO: falta RLS en las tablas del chat';
  end if;
  if has_table_privilege('authenticated', 'public.mensajes', 'insert')
     or has_table_privilege('authenticated', 'public.mensajes', 'update')
     or has_table_privilege('authenticated', 'public.mensajes', 'delete') then
    raise exception 'FALLO: un mensaje se puede escribir, editar o borrar sin pasar por enviar_mensaje';
  end if;
  if has_table_privilege('authenticated', 'public.mensaje_lecturas', 'insert') then
    raise exception 'FALLO: una lectura se puede inventar sin marcar_leidos';
  end if;
  if has_table_privilege('anon', 'public.mensajes', 'select') then
    raise exception 'FALLO: anon lee el chat';
  end if;
  if has_function_privilege('anon', 'public.enviar_mensaje(uuid, text, jsonb, jsonb)', 'execute') then
    raise exception 'FALLO: anon puede enviar mensajes';
  end if;
  if (select count(*) from public.conversaciones where tipo = 'general') <> 1 then
    raise exception 'FALLO: tiene que haber exactamente una sala general';
  end if;
  if to_regclass('public.pedido_mensajes') is not null then
    raise exception 'FALLO: pedido_mensajes debió reemplazarse';
  end if;
  if public.referencias_validas('[{"alias":"x1","tipo":"cliente","id":"1","etiqueta":"A"}]') then
    raise exception 'FALLO: aceptó un alias que no es rN';
  end if;
  if not public.referencias_validas('[{"alias":"r1","tipo":"pedido","id":"P2611-001","etiqueta":"P2611-001"}]') then
    raise exception 'FALLO: rechazó una referencia válida';
  end if;
  if public.texto_con_etiquetas('Mira @r1 y @r10', '[{"alias":"r1","etiqueta":"P2611-001"},{"alias":"r10","etiqueta":"Ana"}]')
     <> 'Mira @P2611-001 y @Ana' then
    raise exception 'FALLO: texto_con_etiquetas cambió mal las fichas';
  end if;
end $$;

-- ── 2. Tres personas de prueba ──────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000c4a1', 'chat-admin@prueba.test',
   '{"nombre":"Admin Chat","usuario":"chat-admin"}',
   '{"rol":"administracion"}'),
  ('00000000-0000-4000-8000-00000000c4a2', 'chat-logi@prueba.test',
   '{"nombre":"Logi Chat","usuario":"chat-logi"}',
   '{"rol":"logistica"}'),
  ('00000000-0000-4000-8000-00000000c4a3', 'chat-ope@prueba.test',
   '{"nombre":"Ope Chat","usuario":"chat-ope"}',
   '{"rol":"operaciones"}');

update public.usuarios set creado_en = now() - interval '1 day'
 where id in ('00000000-0000-4000-8000-00000000c4a1', '00000000-0000-4000-8000-00000000c4a2',
              '00000000-0000-4000-8000-00000000c4a3');

create temp table t (clave text primary key, valor text);
grant all on t to authenticated;

-- ── 3. Administración crea un canal con Logística (sin Operaciones) ─────────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c4a1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_canal uuid;
  v_msg   uuid;
begin
  v_canal := public.crear_canal('Taller', 'Lo del taller', array['00000000-0000-4000-8000-00000000c4a2']::uuid[]);
  insert into t values ('canal', v_canal);

  if (select count(*) from public.conversacion_miembros where conversacion_id = v_canal) <> 2 then
    raise exception 'FALLO: el canal debía quedar con quien lo creó y Logística';
  end if;

  v_msg := public.enviar_mensaje(
    v_canal, 'Hola @r1, revisa @r2',
    '[{"alias":"r1","tipo":"usuario","id":"00000000-0000-4000-8000-00000000c4a2","etiqueta":"Logi Chat"},
      {"alias":"r2","tipo":"pedido","id":"P2611-001","etiqueta":"P2611-001"}]');
  insert into t values ('msg', v_msg);

  if (select autor_nombre from public.mensajes where id = v_msg) <> 'Admin Chat' then
    raise exception 'FALLO: el mensaje no quedó firmado por quien tiene la sesión';
  end if;

  begin
    perform public.enviar_mensaje(v_canal, '   ');
    raise exception 'FALLO: aceptó un mensaje vacío';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;

  begin
    perform public.enviar_mensaje(v_canal, 'con archivo trucho', '[]',
      '[{"ruta":"conversaciones/00000000-0000-4000-8000-000000000000/x.png","nombre":"x.png","mime":"image/png","tamano":10}]');
    raise exception 'FALLO: aceptó un adjunto de otra conversación';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

reset role;

-- La mención encoló un aviso para Logística.
do $$
begin
  if not exists (
    select 1 from public.notificaciones
     where destinatario_id = '00000000-0000-4000-8000-00000000c4a2' and tipo = 'mencion'
       and cuerpo like '%@Logi Chat%@P2611-001%'
  ) then
    raise exception 'FALLO: la mención no encoló el aviso con las etiquetas';
  end if;
end $$;

-- ── 4. Operaciones no ve el canal; Logística sí, y lo marca como visto ─────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c4a3","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.mensajes where id = (select valor::uuid from t where clave = 'msg')) then
    raise exception 'FALLO: Operaciones lee un canal donde no está';
  end if;
  if exists (select 1 from public.resumen_conversaciones() where id = (select valor::uuid from t where clave = 'canal')) then
    raise exception 'FALLO: el canal aparece en la lista de quien no está';
  end if;
  if not exists (select 1 from public.resumen_conversaciones() where tipo = 'general') then
    raise exception 'FALLO: Operaciones no ve la sala general';
  end if;
  begin
    perform public.crear_canal('Mío', null, '{}');
    raise exception 'FALLO: Operaciones creó un canal';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c4a2","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_canal uuid := (select valor::uuid from t where clave = 'canal');
  r record;
begin
  select * into r from public.resumen_conversaciones() where id = v_canal;
  if r.sin_leer <> 1 or r.menciones_sin_leer <> 1 then
    raise exception 'FALLO: Logística debía tener 1 sin leer y 1 mención (tiene % y %)', r.sin_leer, r.menciones_sin_leer;
  end if;
  if public.marcar_leidos(v_canal) <> 1 then
    raise exception 'FALLO: marcar_leidos no marcó el mensaje';
  end if;
  if public.marcar_leidos(v_canal) <> 0 then
    raise exception 'FALLO: marcar_leidos marcó dos veces';
  end if;
  select * into r from public.resumen_conversaciones() where id = v_canal;
  if r.sin_leer <> 0 then
    raise exception 'FALLO: después de leer sigue habiendo sin leer';
  end if;
  if (select count(*) from public.participantes_conversacion(v_canal)) <> 2 then
    raise exception 'FALLO: el canal debía tener 2 participantes';
  end if;
end $$;

-- ── 5. Directo: uno solo entre dos personas, y avisa al otro ────────────────

do $$
declare
  a uuid;
  b uuid;
begin
  a := public.abrir_directo('00000000-0000-4000-8000-00000000c4a3');
  b := public.abrir_directo('00000000-0000-4000-8000-00000000c4a3');
  if a <> b then
    raise exception 'FALLO: se abrieron dos directos entre las mismas personas';
  end if;
  perform public.enviar_mensaje(a, 'Hola Ope');
  insert into t values ('directo', a);
end $$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.notificaciones
     where destinatario_id = '00000000-0000-4000-8000-00000000c4a3' and tipo = 'mensaje_directo'
  ) then
    raise exception 'FALLO: el directo no avisó a quien lo recibe';
  end if;
end $$;

-- Administración no lee los directos de otros.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c4a1","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.mensajes where conversacion_id = (select valor::uuid from t where clave = 'directo')) then
    raise exception 'FALLO: Administración lee un directo ajeno';
  end if;
end $$;

reset role;

select 'chat.sql: todo OK' as resultado;

rollback;
