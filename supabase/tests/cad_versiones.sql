-- Verificación de la migración 20261129000300 (versiones de los diseños y los tres roles).
--
--   npx supabase db query --linked -f supabase/tests/cad_versiones.sql
--
-- No necesita las cuentas del seed: crea tres personas de prueba (una por rol)
-- dentro de una transacción que termina en ROLLBACK, así que no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if has_table_privilege('authenticated', 'public.cad_diseno_versiones', 'update')
     or has_column_privilege('authenticated', 'public.cad_diseno_versiones', 'nombre_version', 'update') then
    raise exception 'FALLO: el nombre de una versión se cambia sin pasar por nombrar_version_diseno';
  end if;
  if has_function_privilege('anon', 'public.restaurar_version_diseno(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.nombrar_version_diseno(uuid, integer, text)', 'execute') then
    raise exception 'FALLO: anon puede restaurar o nombrar versiones';
  end if;
  if has_function_privilege('authenticated', 'public.notificar_diseno_modificado()', 'execute') then
    raise exception 'FALLO: el trigger de avisos se puede llamar suelto';
  end if;
end $$;

-- ── 2. Tres personas de prueba ──────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000d5a1', 'ver-admin@prueba.test',
   '{"nombre":"Ana Prueba","usuario":"ver-admin","rol":"administracion"}'),
  ('00000000-0000-4000-8000-00000000d5a2', 'ver-logi@prueba.test',
   '{"nombre":"Carla Prueba","usuario":"ver-logi","rol":"logistica"}'),
  ('00000000-0000-4000-8000-00000000d5a3', 'ver-ope@prueba.test',
   '{"nombre":"Miguel Prueba","usuario":"ver-ope","rol":"operaciones"}');

create temp table t (clave text primary key, valor text);
grant all on t to authenticated;

-- Avisos de diseños de las personas de prueba (como postgres: la cola solo la
-- lee su destinatario).
create function pg_temp.avisos(p_dest uuid, p_diseno text)
returns bigint language sql as $$
  select count(*) from public.notificaciones
   where destinatario_id = p_dest and tipo = 'diseno_modificado' and url = '/disenos/' || p_diseno || '?historial=1'
$$;

-- ── 3. Ana crea un diseño y guarda dos versiones ────────────────────────────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno uuid;
  v_fila   public.cad_diseno_versiones%rowtype;
begin
  insert into public.cad_disenos (nombre) values ('Caja de Ana') returning id into v_diseno;
  insert into t values ('diseno', v_diseno::text);

  perform public.guardar_version_diseno(v_diseno, 'caja', '{"largo": 100}'::jsonb, 'formulario');
  perform public.guardar_version_diseno(v_diseno, 'caja', '{"largo": 200}'::jsonb, 'chat');

  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = 2;
  if v_fila.autor_nombre <> 'Ana Prueba' then
    raise exception 'FALLO: la versión no copió el nombre de quien la guardó (%)', v_fila.autor_nombre;
  end if;

  -- El navegador no puede firmar a nombre de otra persona.
  insert into public.cad_diseno_versiones (diseno_id, version, plantilla, origen, creado_por)
  values (v_diseno, 99, 'caja', 'formulario', '00000000-0000-4000-8000-00000000d5a2');
  if (select creado_por from public.cad_diseno_versiones where diseno_id = v_diseno and version = 99)
     <> '00000000-0000-4000-8000-00000000d5a1' then
    raise exception 'FALLO: una versión quedó firmada por otra persona que la sesión';
  end if;
end $$;

-- Sin DELETE para authenticated: la v99 de la prueba se quita como postgres.
set local role postgres;
delete from public.cad_diseno_versiones where version = 99 and diseno_id = (select valor::uuid from t where clave = 'diseno');

do $$
declare
  v_diseno text := (select valor from t where clave = 'diseno');
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno) <> 0 then
    raise exception 'FALLO: se le avisó a Ana de sus propios cambios';
  end if;
end $$;

-- ── 4. Carla (Logística) edita el diseño de Ana: se le avisa a Ana ─────────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a2","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno  uuid := (select valor::uuid from t where clave = 'diseno');
  v_version integer;
begin
  v_version := public.guardar_version_diseno(v_diseno, 'caja', '{"largo": 300}'::jsonb, 'formulario');
  if v_version <> 3 then raise exception 'FALLO: la versión de Carla no es la 3 (es la %)', v_version; end if;
  if (select autor_nombre from public.cad_diseno_versiones where diseno_id = v_diseno and version = 3) <> 'Carla Prueba' then
    raise exception 'FALLO: la versión de Carla no lleva su nombre';
  end if;
  -- Sigue editando enseguida: no hace falta otro aviso.
  perform public.guardar_version_diseno(v_diseno, 'caja', '{"largo": 310}'::jsonb, 'formulario');
  perform public.guardar_version_diseno(v_diseno, 'caja', '{"largo": 320}'::jsonb, 'formulario');
end $$;

set local role postgres;

do $$
declare
  v_diseno text := (select valor from t where clave = 'diseno');
  v_aviso  public.notificaciones%rowtype;
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno) <> 1 then
    raise exception 'FALLO: Ana debió recibir exactamente un aviso (recibió %)',
      pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno);
  end if;
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a2', v_diseno) <> 0 then
    raise exception 'FALLO: se le avisó a Carla de sus propios cambios';
  end if;
  select * into v_aviso from public.notificaciones
   where destinatario_id = '00000000-0000-4000-8000-00000000d5a1' and tipo = 'diseno_modificado';
  if v_aviso.titulo <> 'Carla Prueba modificó tu diseño' or v_aviso.cuerpo not like 'Caja de Ana%' then
    raise exception 'FALLO: el aviso no dice lo esperado: % / %', v_aviso.titulo, v_aviso.cuerpo;
  end if;
end $$;

-- ── 5. Ana vuelve a su versión: restaurar numera, copia y avisa a Carla ────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno  uuid := (select valor::uuid from t where clave = 'diseno');
  v_version integer;
  v_fila    public.cad_diseno_versiones%rowtype;
begin
  v_version := public.restaurar_version_diseno(v_diseno, 2);
  if v_version <> 6 then raise exception 'FALLO: la restauración no es la v6 (es la %)', v_version; end if;
  if (select version_actual from public.cad_disenos where id = v_diseno) <> 6 then
    raise exception 'FALLO: el diseño no apunta a la versión restaurada';
  end if;
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = 6;
  if v_fila.origen <> 'restauracion' or v_fila.restaurada_de <> 2
     or (v_fila.parametros ->> 'largo')::numeric <> 200 or v_fila.plantilla <> 'caja'
     or v_fila.autor_nombre <> 'Ana Prueba' or v_fila.estado <> 'aprobado' then
    raise exception 'FALLO: la restauración no copió la v2 como se esperaba';
  end if;

  -- La actual no se restaura.
  begin
    perform public.restaurar_version_diseno(v_diseno, 6);
    raise exception 'FALLO: se restauró la versión actual';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  -- Una que no existe, tampoco.
  begin
    perform public.restaurar_version_diseno(v_diseno, 50);
    raise exception 'FALLO: se restauró una versión que no existe';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  if (select version_actual from public.cad_disenos where id = v_diseno) <> 6 then
    raise exception 'FALLO: una restauración rechazada movió la versión vigente';
  end if;

  -- 'restauracion' no entra por guardar_version_diseno (le falta de cuál viene).
  begin
    perform public.guardar_version_diseno(v_diseno, 'caja', '{}'::jsonb, 'restauracion');
    raise exception 'FALLO: se guardó una restauración sin versión de origen';
  exception when check_violation then null; end;

  -- Ponerle nombre, cambiarlo y quitarlo.
  perform public.nombrar_version_diseno(v_diseno, 2, '  Aprobada por el cliente ');
  if (select nombre_version from public.cad_diseno_versiones where diseno_id = v_diseno and version = 2)
     <> 'Aprobada por el cliente' then
    raise exception 'FALLO: la versión no quedó con su nombre';
  end if;
  perform public.nombrar_version_diseno(v_diseno, 2, '');
  if (select nombre_version from public.cad_diseno_versiones where diseno_id = v_diseno and version = 2) is not null then
    raise exception 'FALLO: no se pudo quitar el nombre de la versión';
  end if;
  begin
    perform public.nombrar_version_diseno(v_diseno, 2, repeat('x', 81));
    raise exception 'FALLO: se aceptó un nombre de más de 80 caracteres';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    perform public.nombrar_version_diseno(v_diseno, 50, 'Nada');
    raise exception 'FALLO: se nombró una versión que no existe';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

do $$
declare
  v_diseno text := (select valor from t where clave = 'diseno');
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a2', v_diseno) <> 1 then
    raise exception 'FALLO: Carla debió recibir un aviso por la restauración (recibió %)',
      pg_temp.avisos('00000000-0000-4000-8000-00000000d5a2', v_diseno);
  end if;
  if not exists (select 1 from public.notificaciones
                  where destinatario_id = '00000000-0000-4000-8000-00000000d5a2'
                    and titulo = 'Ana Prueba modificó un diseño que editaste'
                    and cuerpo like '%volvió a la v2 (ahora v6)%') then
    raise exception 'FALLO: el aviso de la restauración no dice lo esperado';
  end if;
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno) <> 1 then
    raise exception 'FALLO: se le avisó a Ana de su propia restauración';
  end if;
end $$;

-- ── 6. Anti-inundación: Miguel guarda; Ana ya fue avisada y no volvió a
--       guardar desde ese aviso... salvo que sí guardó (la restauración) ─────

-- El aviso de Ana (paso 4) es anterior a su restauración (paso 5): como volvió
-- a guardar, un cambio nuevo de otra persona sí le llega. Se separan en el
-- tiempo porque toda la prueba corre en una transacción (now() fijo).
update public.notificaciones set creado_en = now() - interval '10 minutes'
 where destinatario_id = '00000000-0000-4000-8000-00000000d5a1' and tipo = 'diseno_modificado';
update public.cad_diseno_versiones set creado_en = now() - interval '5 minutes'
 where diseno_id = (select valor::uuid from t where clave = 'diseno') and version = 6;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a3","role":"authenticated"}', true);
set local role authenticated;
select public.guardar_version_diseno((select valor::uuid from t where clave = 'diseno'), 'caja', '{"largo": 400}'::jsonb, 'formulario');
set local role postgres;

do $$
declare
  v_diseno text := (select valor from t where clave = 'diseno');
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno) <> 2 then
    raise exception 'FALLO: Ana volvió a guardar y no se le avisó del cambio de Miguel (avisos: %)',
      pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno);
  end if;
end $$;

-- Y ahora, sin que Ana guarde, Miguel sigue: no hay aviso nuevo para ella.
-- Pasada media hora, sí.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a3","role":"authenticated"}', true);
set local role authenticated;
select public.guardar_version_diseno((select valor::uuid from t where clave = 'diseno'), 'caja', '{"largo": 410}'::jsonb, 'formulario');
set local role postgres;

do $$
declare
  v_diseno text := (select valor from t where clave = 'diseno');
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno) <> 2 then
    raise exception 'FALLO: Ana recibió otro aviso antes de la media hora sin haber guardado';
  end if;
end $$;

update public.notificaciones set creado_en = now() - interval '31 minutes'
 where destinatario_id = '00000000-0000-4000-8000-00000000d5a1' and tipo = 'diseno_modificado';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a3","role":"authenticated"}', true);
set local role authenticated;
select public.guardar_version_diseno((select valor::uuid from t where clave = 'diseno'), 'caja', '{"largo": 420}'::jsonb, 'formulario');
set local role postgres;

do $$
declare
  v_diseno text := (select valor from t where clave = 'diseno');
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a1', v_diseno) <> 3 then
    raise exception 'FALLO: pasada la media hora, Ana no recibió el aviso';
  end if;
end $$;

-- Una cuenta desactivada no recibe avisos.
update public.usuarios set activo = false where id = '00000000-0000-4000-8000-00000000d5a2';
update public.notificaciones set creado_en = now() - interval '31 minutes'
 where destinatario_id = '00000000-0000-4000-8000-00000000d5a2';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a3","role":"authenticated"}', true);
set local role authenticated;
select public.restaurar_version_diseno((select valor::uuid from t where clave = 'diseno'), 3);
set local role postgres;

do $$
begin
  if pg_temp.avisos('00000000-0000-4000-8000-00000000d5a2', (select valor from t where clave = 'diseno')) <> 1 then
    raise exception 'FALLO: se le avisó a una cuenta desactivada';
  end if;
end $$;
update public.usuarios set activo = true where id = '00000000-0000-4000-8000-00000000d5a2';

-- ── 7. Diseño libre: la aprobación se conserva solo con el mismo código ────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno  uuid;
  v_version integer;
  v_fila    public.cad_diseno_versiones%rowtype;
begin
  insert into public.cad_disenos (nombre) values ('Libre de Ana') returning id into v_diseno;
  perform public.guardar_version_diseno_libre(v_diseno, 'piezas = [1]');        -- v1 borrador
  perform public.aprobar_version_diseno(v_diseno, 1);                          -- v1 aprobada
  perform public.guardar_version_diseno_libre(v_diseno, 'piezas = [2]');        -- v2 borrador
  perform public.guardar_version_diseno(v_diseno, 'caja', '{}'::jsonb, 'formulario'); -- v3 plantilla

  -- Restaurar la v1 (aprobada): la copia sigue aprobada, con la misma firma.
  v_version := public.restaurar_version_diseno(v_diseno, 1);
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = v_version;
  if v_fila.estado <> 'aprobado' or v_fila.codigo <> 'piezas = [1]' or v_fila.plantilla <> 'libre'
     or v_fila.aprobado_por <> '00000000-0000-4000-8000-00000000d5a1' or v_fila.aprobado_en is null then
    raise exception 'FALLO: restaurar un código aprobado no conservó la aprobación';
  end if;

  -- Restaurar la v2 (otro código, nunca aprobado): nace en borrador.
  v_version := public.restaurar_version_diseno(v_diseno, 2);
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = v_version;
  if v_fila.estado <> 'borrador' or v_fila.aprobado_por is not null or v_fila.codigo <> 'piezas = [2]' then
    raise exception 'FALLO: restaurar un código sin aprobar no nació en borrador';
  end if;

  -- Restaurar la v3 (plantilla): aprobada y sin código, como toda plantilla.
  v_version := public.restaurar_version_diseno(v_diseno, 3);
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = v_version;
  if v_fila.estado <> 'aprobado' or v_fila.codigo is not null or v_fila.aprobado_por is not null then
    raise exception 'FALLO: restaurar una versión de plantilla no quedó como una de plantilla';
  end if;
end $$;

-- Aprobar sigue siendo de Administración.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5a2","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno uuid := (select id from public.cad_disenos where nombre = 'Libre de Ana');
begin
  begin
    perform public.aprobar_version_diseno(v_diseno, 5);
    raise exception 'FALLO: Logística pudo aprobar un diseño libre';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  -- Pero nombrar y restaurar, sí.
  perform public.nombrar_version_diseno(v_diseno, 1, 'La buena');
  perform public.restaurar_version_diseno(v_diseno, 1);
end $$;

-- Sin sesión activa (cuenta desactivada), nada.
set local role postgres;
update public.usuarios set activo = false where id = '00000000-0000-4000-8000-00000000d5a2';
set local role authenticated;

do $$
declare
  v_diseno uuid := (select id from public.cad_disenos where nombre = 'Libre de Ana');
begin
  if v_diseno is not null then
    raise exception 'FALLO: una cuenta desactivada ve los diseños';
  end if;
  begin
    perform public.nombrar_version_diseno(
      (select id from public.cad_disenos limit 1), 1, 'Intruso');
    raise exception 'FALLO: una cuenta desactivada pudo nombrar una versión';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

select 'cad versiones: todo en orden' as resultado;

rollback;
