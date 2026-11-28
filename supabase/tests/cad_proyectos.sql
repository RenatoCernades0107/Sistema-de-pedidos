-- Verificación de la migración 20261226000100 (proyectos de diseños).
--
--   npx supabase db query --linked -f supabase/tests/cad_proyectos.sql
--
-- Crea tres personas de prueba (una por rol), un proyecto y diseños dentro de una
-- transacción que termina en ROLLBACK, así que no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.cad_proyectos'::regclass) then
    raise exception 'FALLO: cad_proyectos sin RLS';
  end if;
  if has_table_privilege('anon', 'public.cad_proyectos', 'select') then
    raise exception 'FALLO: anon lee cad_proyectos';
  end if;
  if has_function_privilege('anon', 'public.aprobar_proyecto(uuid)', 'execute') then
    raise exception 'FALLO: anon puede aprobar un proyecto';
  end if;
end $$;

-- ── 2. Tres personas de prueba ──────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000d7a1', 'pry-admin@prueba.test',
   '{"nombre":"Ana Prueba","usuario":"pry-admin"}', '{"rol":"administracion"}'),
  ('00000000-0000-4000-8000-00000000d7a2', 'pry-logi@prueba.test',
   '{"nombre":"Carla Prueba","usuario":"pry-logi"}', '{"rol":"logistica"}'),
  ('00000000-0000-4000-8000-00000000d7a3', 'pry-ope@prueba.test',
   '{"nombre":"Miguel Prueba","usuario":"pry-ope"}', '{"rol":"operaciones"}');

create temp table t (clave text primary key, valor text);
grant all on t to authenticated;

-- ── 3. Miguel (operaciones) arma un proyecto con cuatro diseños ─────────────

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d7a3","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_proy uuid;
  v_libre_borrador uuid;
  v_libre_aprobado uuid;
  v_plantilla uuid;
  v_vacio uuid;
begin
  insert into public.cad_proyectos (nombre) values ('Hurley') returning id into v_proy;
  insert into t values ('proy', v_proy::text);

  if (select creado_por from public.cad_proyectos where id = v_proy) <> '00000000-0000-4000-8000-00000000d7a3'::uuid then
    raise exception 'FALLO: creado_por no es quien insertó';
  end if;

  begin
    insert into public.cad_proyectos (nombre) values ('   ');
    raise exception 'FALLO: acepta un proyecto sin nombre';
  exception when check_violation then null;
  end;
  begin
    insert into public.cad_proyectos (nombre) values (repeat('x', 121));
    raise exception 'FALLO: acepta un nombre de más de 120 caracteres';
  exception when check_violation then null;
  end;

  insert into public.cad_disenos (nombre, proyecto_id, orden) values ('Logo fachada', v_proy, 1) returning id into v_libre_borrador;
  insert into public.cad_disenos (nombre, proyecto_id, orden) values ('Logo counter', v_proy, 2) returning id into v_libre_aprobado;
  insert into public.cad_disenos (nombre, proyecto_id, orden) values ('Fitting room', v_proy, 3) returning id into v_plantilla;
  insert into public.cad_disenos (nombre, proyecto_id, orden) values ('Sin tocar', v_proy, 4) returning id into v_vacio;
  insert into t values ('libre_borrador', v_libre_borrador::text), ('libre_aprobado', v_libre_aprobado::text),
                       ('plantilla', v_plantilla::text), ('vacio', v_vacio::text);

  begin
    insert into public.cad_disenos (nombre, proyecto_id, orden) values ('Orden cero', v_proy, 0);
    raise exception 'FALLO: acepta orden 0';
  exception when check_violation then null;
  end;

  perform public.guardar_version_diseno_libre(v_libre_borrador, 'piezas = []', 'chat');
  perform public.guardar_version_diseno_libre(v_libre_aprobado, 'piezas = []', 'chat');
  perform public.guardar_version_diseno(v_plantilla, 'caja', '{"largo": 100}'::jsonb, 'formulario');
end $$;

-- ── 4. Miguel no puede aprobar; Administración sí ───────────────────────────

do $$
begin
  begin
    perform public.aprobar_proyecto((select valor::uuid from t where clave = 'proy'));
    raise exception 'FALLO: operaciones aprobó un proyecto';
  exception when others then
    if sqlerrm not like '%Solo Administración%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d7a1","role":"authenticated"}', true);

do $$
declare
  v_proy uuid := (select valor::uuid from t where clave = 'proy');
  v_n integer;
begin
  -- Antes de aprobar uno de los libres a mano, para probar que no falla por él.
  perform public.aprobar_version_diseno((select valor::uuid from t where clave = 'libre_aprobado'), 1);

  v_n := public.aprobar_proyecto(v_proy);
  if v_n <> 1 then
    raise exception 'FALLO: aprobó % versiones y debía aprobar 1 (la libre en borrador)', v_n;
  end if;
  if (select estado from public.cad_diseno_versiones where diseno_id = (select valor::uuid from t where clave = 'libre_borrador') and version = 1) <> 'aprobado' then
    raise exception 'FALLO: la libre en borrador no quedó aprobada';
  end if;
  if (select aprobado_por from public.cad_diseno_versiones where diseno_id = (select valor::uuid from t where clave = 'libre_borrador') and version = 1)
     <> '00000000-0000-4000-8000-00000000d7a1'::uuid then
    raise exception 'FALLO: aprobado_por no es quien aprobó';
  end if;

  -- Idempotente: una segunda vez no aprueba nada y no falla.
  if public.aprobar_proyecto(v_proy) <> 0 then
    raise exception 'FALLO: aprobar dos veces aprobó algo más';
  end if;

  begin
    perform public.aprobar_proyecto('00000000-0000-4000-8000-000000000000');
    raise exception 'FALLO: aprobó un proyecto que no existe';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;
end $$;

-- Una versión nueva de un diseño ya aprobado nace en borrador: aprobar el
-- proyecto vuelve a aprobar solo esa.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d7a3","role":"authenticated"}', true);

do $$
begin
  perform public.guardar_version_diseno_libre((select valor::uuid from t where clave = 'libre_borrador'), 'piezas = [] # v2', 'chat');
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d7a1","role":"authenticated"}', true);

do $$
begin
  if public.aprobar_proyecto((select valor::uuid from t where clave = 'proy')) <> 1 then
    raise exception 'FALLO: no aprobó la versión nueva en borrador';
  end if;
end $$;

-- ── 5. Borrar: solo quien lo creó o Administración; los diseños quedan sueltos ─

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d7a2","role":"authenticated"}', true);

do $$
declare
  v_proy uuid := (select valor::uuid from t where clave = 'proy');
begin
  -- Carla (logística) ve el proyecto y lo edita, pero no lo borra (no es suyo).
  if not exists (select 1 from public.cad_proyectos where id = v_proy) then
    raise exception 'FALLO: logística no ve el proyecto';
  end if;
  update public.cad_proyectos set nombre = 'Hurley Trujillo' where id = v_proy;
  if (select nombre from public.cad_proyectos where id = v_proy) <> 'Hurley Trujillo' then
    raise exception 'FALLO: logística no pudo renombrar el proyecto';
  end if;
  delete from public.cad_proyectos where id = v_proy;
  if not exists (select 1 from public.cad_proyectos where id = v_proy) then
    raise exception 'FALLO: logística borró un proyecto ajeno';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d7a3","role":"authenticated"}', true);

do $$
declare
  v_proy uuid := (select valor::uuid from t where clave = 'proy');
begin
  delete from public.cad_proyectos where id = v_proy;
  if exists (select 1 from public.cad_proyectos where id = v_proy) then
    raise exception 'FALLO: quien creó el proyecto no pudo borrarlo';
  end if;
  if (select count(*) from public.cad_disenos where id in (select valor::uuid from t where clave <> 'proy')) <> 4 then
    raise exception 'FALLO: borrar el proyecto se llevó sus diseños';
  end if;
  if exists (select 1 from public.cad_disenos where id in (select valor::uuid from t where clave <> 'proy') and proyecto_id is not null) then
    raise exception 'FALLO: los diseños siguen apuntando al proyecto borrado';
  end if;
end $$;

-- ── 6. Sin sesión, nada ─────────────────────────────────────────────────────

select set_config('request.jwt.claims', '', true);

do $$
begin
  if exists (select 1 from public.cad_proyectos) then
    raise exception 'FALLO: sin sesión se ven proyectos';
  end if;
end $$;

set local role postgres;

select 'cad proyectos: todo en orden' as resultado;

rollback;
