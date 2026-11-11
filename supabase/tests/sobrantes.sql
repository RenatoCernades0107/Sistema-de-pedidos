-- Verificación de la migración 20261112000100 (sobrantes), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/sobrantes.sql
--
-- Como `cortes.sql`, no necesita las cuentas del seed: entra como un usuario que
-- no es de Administración (el taller registra sobrantes) y, si no hay, se salta
-- esa parte. Todo dentro de una transacción que termina en ROLLBACK.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_class where relname = 'sobrantes'
               and relnamespace = 'public'::regnamespace and not relrowsecurity) then
    raise exception 'FALLO: falta RLS en sobrantes';
  end if;
  if has_table_privilege('anon', 'public.sobrantes', 'select') then
    raise exception 'FALLO: anon puede leer los sobrantes';
  end if;
  if has_table_privilege('authenticated', 'public.sobrantes', 'delete') then
    raise exception 'FALLO: un sobrante se puede borrar en vez de marcarse';
  end if;
end $$;

-- ── 2. Como alguien que no es Administración ────────────────────────────────

-- Una secuencia no vuelve atrás con el ROLLBACK: se guarda cómo está y se deja
-- igual al final, para que la prueba 2.4 no salte la numeración de verdad.
select set_config('plexi.secuencia',
                  (select last_value || ',' || is_called from public.sobrantes_numero_seq),
                  true);

select set_config('plexi.test_otro',
                  coalesce((select id::text from public.usuarios where rol <> 'administracion' and activo
                             order by creado_en limit 1), ''),
                  true);
select set_config('plexi.grupo',
                  (select g.id::text from public.grupos_plancha g
                     join public.formatos_plancha f on f.grupo_id = g.id
                    order by f.codigo_odoo limit 1),
                  true);
select set_config('request.jwt.claims',
                  json_build_object('sub', nullif(current_setting('plexi.test_otro'), ''), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  v_grupo  uuid := current_setting('plexi.grupo')::uuid;
  v_fila   public.sobrantes%rowtype;
  v_codigo text;
begin
  if current_setting('plexi.test_otro') = '' then
    raise notice 'No hay usuarios activos fuera de Administración: se salta la prueba de otro rol';
    return;
  end if;

  -- 2.1 El catálogo se lee (para elegir el material), pero no se escribe.
  if not exists (select 1 from public.grupos_plancha) or not exists (select 1 from public.formatos_plancha) then
    raise exception 'FALLO: otro rol no ve el catálogo de planchas';
  end if;
  update public.grupos_plancha set rotable = rotable where id = v_grupo;
  if found then raise exception 'FALLO: otro rol pudo escribir el catálogo'; end if;

  -- 2.2 Registra un sobrante: nace con código, disponible y firmado.
  insert into public.sobrantes (grupo_id, largo_cm, ancho_cm, ubicacion)
  values (v_grupo, 120, 45, 'Rack 2')
  returning * into v_fila;
  if v_fila.codigo !~ '^SOB-\d{5,}$' then raise exception 'FALLO: código inesperado %', v_fila.codigo; end if;
  if v_fila.estado <> 'disponible' or v_fila.sincronizacion <> 'pendiente' then
    raise exception 'FALLO: un sobrante nuevo no nace disponible y pendiente de Odoo';
  end if;
  if v_fila.creado_por::text <> current_setting('plexi.test_otro') then
    raise exception 'FALLO: el sobrante no quedó firmado por quien lo registró';
  end if;

  -- 2.3 El largo es el lado mayor.
  begin
    insert into public.sobrantes (grupo_id, largo_cm, ancho_cm) values (v_grupo, 40, 90);
    raise exception 'FALLO: se aceptó un largo menor que el ancho';
  exception when check_violation then null; end;

  -- 2.4 Un lote de Odoo con nombre de la app adelanta la numeración.
  insert into public.sobrantes (codigo, grupo_id, largo_cm, ancho_cm, origen)
  values ('SOB-90000', v_grupo, 100, 50, 'odoo');
  insert into public.sobrantes (grupo_id, largo_cm, ancho_cm) values (v_grupo, 100, 50)
  returning codigo into v_codigo;
  if v_codigo <> 'SOB-90001' then
    raise exception 'FALLO: después de SOB-90000 la numeración siguió en %', v_codigo;
  end if;
  -- Y un lote con otro nombre se guarda tal cual.
  insert into public.sobrantes (codigo, grupo_id, largo_cm, ancho_cm, origen)
  values ('LOTE-7', v_grupo, 100, 50, 'odoo');

  -- 2.5 Se marca, no se borra.
  update public.sobrantes set estado = 'consumido' where id = v_fila.id;
  if not found then raise exception 'FALLO: otro rol no pudo marcar un sobrante'; end if;

  -- 2.6 El lado mínimo sale de la configuración, aunque este rol no la lea.
  if public.retazo_minimo() is null or public.retazo_minimo() <= 0 then
    raise exception 'FALLO: retazo_minimo() no devolvió un número';
  end if;
end $$;

set local role postgres;

select setval('public.sobrantes_numero_seq',
              split_part(current_setting('plexi.secuencia'), ',', 1)::bigint,
              split_part(current_setting('plexi.secuencia'), ',', 2)::boolean);

select 'sobrantes: todo en orden' as resultado;

rollback;
