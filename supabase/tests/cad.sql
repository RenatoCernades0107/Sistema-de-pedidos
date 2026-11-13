-- Verificación de la migración 20261116000100 (diseños CAD), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/cad.sql
--
-- Como `cortes.sql`, no necesita las cuentas del seed: entra como el primer
-- usuario activo de Administración que encuentre (y, si hay, como uno de otro
-- rol). Todo dentro de una transacción que termina en ROLLBACK: no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from pg_class
     where relname in ('cad_disenos', 'cad_diseno_versiones', 'cad_mensajes')
       and relnamespace = 'public'::regnamespace and not relrowsecurity
  ) then
    raise exception 'FALLO: falta RLS en las tablas de diseños';
  end if;
  if has_table_privilege('anon', 'public.cad_disenos', 'select')
     or has_table_privilege('anon', 'public.cad_diseno_versiones', 'select')
     or has_table_privilege('anon', 'public.cad_mensajes', 'select') then
    raise exception 'FALLO: anon puede leer los diseños';
  end if;
  if has_table_privilege('authenticated', 'public.cad_diseno_versiones', 'update')
     or has_table_privilege('authenticated', 'public.cad_diseno_versiones', 'delete') then
    raise exception 'FALLO: una versión guardada se puede corregir o borrar suelta';
  end if;
  if has_table_privilege('authenticated', 'public.cad_mensajes', 'update') then
    raise exception 'FALLO: un mensaje de la conversación se puede editar';
  end if;
  if has_function_privilege('anon', 'public.guardar_version_diseno(uuid, text, jsonb, text, integer, uuid, text, jsonb)', 'execute') then
    raise exception 'FALLO: anon puede ejecutar guardar_version_diseno';
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
  v_diseno  public.cad_disenos%rowtype;
  v_borrar  uuid;
  v_version integer;
  v_fila    public.cad_diseno_versiones%rowtype;
begin
  -- 2.1 Un diseño nuevo nace sin versión, con nombre y firmado.
  insert into public.cad_disenos default values returning * into v_diseno;
  if v_diseno.version_actual <> 0 then
    raise exception 'FALLO: un diseño nuevo no empieza en la versión 0';
  end if;
  if btrim(v_diseno.nombre) = '' then
    raise exception 'FALLO: un diseño nuevo nace sin nombre';
  end if;
  if v_diseno.creado_por::text <> current_setting('plexi.test_admin') then
    raise exception 'FALLO: el diseño no quedó firmado por quien lo creó';
  end if;
  perform set_config('plexi.diseno', v_diseno.id::text, true);

  -- 2.2 Las versiones se numeran 1, 2… y el diseño apunta a la última.
  v_version := public.guardar_version_diseno(
    v_diseno.id, 'caja', '{"largo": 200, "ancho": 150}'::jsonb, 'formulario');
  if v_version <> 1 then raise exception 'FALLO: la primera versión no es la 1 (es la %)', v_version; end if;

  v_version := public.guardar_version_diseno(
    v_diseno.id, 'caja', '{"largo": 250, "ancho": 150}'::jsonb, 'chat', 1);
  if v_version <> 2 then raise exception 'FALLO: la segunda versión no es la 2 (es la %)', v_version; end if;

  if (select version_actual from public.cad_disenos where id = v_diseno.id) <> 2 then
    raise exception 'FALLO: el diseño no apunta a su última versión';
  end if;

  select * into v_fila from public.cad_diseno_versiones
   where diseno_id = v_diseno.id and version = 2;
  if v_fila.origen <> 'chat' or v_fila.version_plantilla <> 1
     or (v_fila.parametros ->> 'largo')::numeric <> 250 then
    raise exception 'FALLO: la versión no guardó lo que se le pasó';
  end if;
  if v_fila.creado_por::text <> current_setting('plexi.test_admin') then
    raise exception 'FALLO: la versión no quedó firmada por quien la guardó';
  end if;

  -- 2.2b Sin material, las columnas nuevas quedan vacías; con material, se guardan.
  if v_fila.grupo_plancha_id is not null or v_fila.color is not null or v_fila.acomodo is not null then
    raise exception 'FALLO: una versión sin material guardó material';
  end if;
  if exists (select 1 from public.grupos_plancha) then
    v_version := public.guardar_version_diseno(
      v_diseno.id, 'caja', '{"espesor": 3}'::jsonb, 'formulario', null,
      (select id from public.grupos_plancha order by id limit 1), '  Rojo ',
      '{"formato_id": "x", "planchas": [], "merma_pct": 12.5}'::jsonb);
    select * into v_fila from public.cad_diseno_versiones
     where diseno_id = v_diseno.id and version = v_version;
    if v_fila.grupo_plancha_id is null or v_fila.color <> 'Rojo'
       or (v_fila.acomodo ->> 'merma_pct')::numeric <> 12.5 then
      raise exception 'FALLO: la versión no guardó el material y su acomodo';
    end if;
    -- Sin material, la siguiente hereda el de la anterior, pero no su acomodo.
    v_version := public.guardar_version_diseno(v_diseno.id, 'caja', '{"espesor": 3}'::jsonb, 'chat');
    select * into v_fila from public.cad_diseno_versiones
     where diseno_id = v_diseno.id and version = v_version;
    if v_fila.grupo_plancha_id is null or v_fila.color <> 'Rojo' or v_fila.acomodo is not null then
      raise exception 'FALLO: la versión siguiente no heredó el material (o heredó el acomodo)';
    end if;
    begin
      perform public.guardar_version_diseno(
        v_diseno.id, 'caja', '{}'::jsonb, 'formulario', null, null, null, '[1]'::jsonb);
      raise exception 'FALLO: se aceptó un acomodo que no es un objeto';
    exception when check_violation then null; end;
  else
    raise notice 'No hay grupos de plancha: se salta la prueba de material';
  end if;

  -- 2.3 Un número de versión no se repite dentro del diseño.
  begin
    insert into public.cad_diseno_versiones (diseno_id, version, plantilla, origen)
    values (v_diseno.id, 2, 'caja', 'formulario');
    raise exception 'FALLO: se repitió un número de versión';
  exception when unique_violation then null; end;

  -- 2.4 El origen es el formulario o el chat, y los parámetros son un objeto.
  begin
    perform public.guardar_version_diseno(v_diseno.id, 'caja', '{}'::jsonb, 'otro');
    raise exception 'FALLO: se aceptó un origen desconocido';
  exception when check_violation then null; end;
  begin
    perform public.guardar_version_diseno(v_diseno.id, 'caja', '[1, 2]'::jsonb, 'chat');
    raise exception 'FALLO: se aceptaron parámetros que no son un objeto';
  exception when check_violation then null; end;
  -- Un guardado rechazado no gasta el número (2, o 3 si se probó el material).
  if (select version_actual from public.cad_disenos where id = v_diseno.id)
     <> (select max(version) from public.cad_diseno_versiones where diseno_id = v_diseno.id) then
    raise exception 'FALLO: un guardado rechazado movió la versión vigente';
  end if;

  -- 2.5 Un diseño que no existe se dice, en vez de numerar en el aire.
  begin
    perform public.guardar_version_diseno(gen_random_uuid(), 'caja', '{}'::jsonb, 'chat');
    raise exception 'FALLO: se guardó una versión de un diseño que no existe';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- 2.6 La conversación: solo usuario y asistente, y el resumen de herramientas es una lista.
  insert into public.cad_mensajes (diseno_id, rol, contenido)
  values (v_diseno.id, 'usuario', 'Una caja de 20 × 15 × 10 cm');
  insert into public.cad_mensajes (diseno_id, rol, contenido, herramientas)
  values (v_diseno.id, 'asistente', 'Listo.', '[{"nombre": "generar_diseno", "ok": true, "resumen": "Caja"}]'::jsonb);
  begin
    insert into public.cad_mensajes (diseno_id, rol, contenido) values (v_diseno.id, 'sistema', 'x');
    raise exception 'FALLO: se aceptó un rol de mensaje desconocido';
  exception when check_violation then null; end;
  begin
    insert into public.cad_mensajes (diseno_id, rol, contenido, herramientas)
    values (v_diseno.id, 'asistente', 'x', '{"a": 1}'::jsonb);
    raise exception 'FALLO: se aceptó un resumen de herramientas que no es una lista';
  exception when check_violation then null; end;

  -- 2.7 Renombrar, pero no a vacío.
  update public.cad_disenos set nombre = 'Caja de prueba' where id = v_diseno.id;
  begin
    update public.cad_disenos set nombre = '  ' where id = v_diseno.id;
    raise exception 'FALLO: se aceptó un nombre vacío';
  exception when check_violation then null; end;

  -- 2.8 Borrar un diseño se lleva sus versiones y su conversación.
  insert into public.cad_disenos default values returning id into v_borrar;
  perform public.guardar_version_diseno(v_borrar, 'caja', '{}'::jsonb, 'formulario');
  insert into public.cad_mensajes (diseno_id, rol, contenido) values (v_borrar, 'usuario', 'hola');
  delete from public.cad_disenos where id = v_borrar;
  if exists (select 1 from public.cad_diseno_versiones where diseno_id = v_borrar)
     or exists (select 1 from public.cad_mensajes where diseno_id = v_borrar) then
    raise exception 'FALLO: borrar el diseño dejó sus versiones o sus mensajes';
  end if;
end $$;

set local role postgres;

-- ── 3. Otro rol no ve ni toca ───────────────────────────────────────────────

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
declare
  v_diseno uuid := current_setting('plexi.diseno')::uuid;
begin
  if current_setting('plexi.test_otro') = '' then return; end if;

  -- El diseño de la sección 2 sigue ahí, pero este rol no lo ve.
  if (select count(*) from public.cad_disenos) > 0
     or (select count(*) from public.cad_diseno_versiones) > 0
     or (select count(*) from public.cad_mensajes) > 0 then
    raise exception 'FALLO: un rol que no es Administración ve los diseños';
  end if;

  update public.cad_disenos set nombre = 'Intruso' where id = v_diseno;
  if found then raise exception 'FALLO: otro rol pudo renombrar un diseño'; end if;
  delete from public.cad_disenos where id = v_diseno;
  if found then raise exception 'FALLO: otro rol pudo borrar un diseño'; end if;

  begin
    insert into public.cad_disenos default values;
    raise exception 'FALLO: otro rol pudo crear un diseño';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    perform public.guardar_version_diseno(v_diseno, 'caja', '{}'::jsonb, 'chat');
    raise exception 'FALLO: otro rol pudo guardar una versión';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    insert into public.cad_mensajes (diseno_id, rol, contenido) values (v_diseno, 'usuario', 'x');
    raise exception 'FALLO: otro rol pudo escribir en la conversación';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

select 'cad: todo en orden' as resultado;

rollback;

-- ── Diseño libre (20261118000100) ───────────────────────────────────────────
-- Bloque propio, con su transacción: versiones con código, en borrador, y la
-- aprobación solo de Administración.

begin;

do $$
begin
  if has_table_privilege('authenticated', 'public.cad_diseno_versiones', 'update') then
    raise exception 'FALLO: una versión se puede actualizar sin pasar por aprobar_version_diseno';
  end if;
  if has_function_privilege('anon', 'public.guardar_version_diseno_libre(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.aprobar_version_diseno(uuid, integer)', 'execute') then
    raise exception 'FALLO: anon puede guardar o aprobar diseños libres';
  end if;
end $$;

select set_config('plexi.test_admin',
                  (select id::text from public.usuarios where rol = 'administracion' and activo
                    order by creado_en limit 1),
                  true);
select set_config('plexi.test_otro',
                  coalesce((select id::text from public.usuarios where rol <> 'administracion' and activo
                             order by creado_en limit 1), ''),
                  true);
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('plexi.test_admin'), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  v_diseno  uuid;
  v_version integer;
  v_fila    public.cad_diseno_versiones%rowtype;
begin
  insert into public.cad_disenos default values returning id into v_diseno;
  perform set_config('plexi.diseno_libre', v_diseno::text, true);

  -- Una versión de plantilla nace aprobada y sin código.
  v_version := public.guardar_version_diseno(v_diseno, 'caja', '{}'::jsonb, 'formulario');
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = v_version;
  if v_fila.estado <> 'aprobado' or v_fila.codigo is not null then
    raise exception 'FALLO: una versión de plantilla no nace aprobada y sin código';
  end if;

  -- La libre: plantilla 'libre', parámetros vacíos, código, borrador, numerada en la misma serie.
  v_version := public.guardar_version_diseno_libre(v_diseno, 'piezas = []');
  if v_version <> 2 then raise exception 'FALLO: la versión libre no siguió la numeración (es la %)', v_version; end if;
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = 2;
  if v_fila.plantilla <> 'libre' or v_fila.codigo <> 'piezas = []' or v_fila.estado <> 'borrador'
     or v_fila.parametros <> '{}'::jsonb or v_fila.origen <> 'chat' then
    raise exception 'FALLO: la versión libre no guardó lo esperado';
  end if;

  -- 'libre' sin código, o código con plantilla, no entran.
  begin
    perform public.guardar_version_diseno(v_diseno, 'libre', '{}'::jsonb, 'chat');
    raise exception 'FALLO: se guardó una versión libre sin código';
  exception when check_violation then null; end;
  begin
    perform public.guardar_version_diseno_libre(v_diseno, '   ');
    raise exception 'FALLO: se guardó una versión libre con código vacío';
  exception when check_violation then null; end;

  -- Aprobar: una vez, firmado.
  perform public.aprobar_version_diseno(v_diseno, 2);
  select * into v_fila from public.cad_diseno_versiones where diseno_id = v_diseno and version = 2;
  if v_fila.estado <> 'aprobado' or v_fila.aprobado_por::text <> current_setting('plexi.test_admin')
     or v_fila.aprobado_en is null then
    raise exception 'FALLO: la aprobación no quedó registrada';
  end if;
  begin
    perform public.aprobar_version_diseno(v_diseno, 2);
    raise exception 'FALLO: se aprobó dos veces la misma versión';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Una versión libre nueva vuelve a nacer en borrador.
  v_version := public.guardar_version_diseno_libre(v_diseno, 'piezas = [1]');
  if (select estado from public.cad_diseno_versiones where diseno_id = v_diseno and version = v_version) <> 'borrador' then
    raise exception 'FALLO: una versión libre nueva no nació en borrador';
  end if;
end $$;

-- Otro rol no puede aprobar ni guardar versiones libres.
set local role postgres;
select set_config('request.jwt.claims',
                  json_build_object('sub', nullif(current_setting('plexi.test_otro'), ''), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  v_diseno uuid := current_setting('plexi.diseno_libre')::uuid;
begin
  if current_setting('plexi.test_otro') = '' then return; end if;
  begin
    perform public.aprobar_version_diseno(v_diseno, 3);
    raise exception 'FALLO: otro rol pudo aprobar un diseño libre';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    perform public.guardar_version_diseno_libre(v_diseno, 'piezas = []');
    raise exception 'FALLO: otro rol pudo guardar una versión libre';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

select 'cad diseño libre: todo en orden' as resultado;

rollback;
