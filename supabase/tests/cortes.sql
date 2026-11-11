-- Verificación de la migración 20261110000100 (configuración de cortes y catálogo
-- de planchas), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/cortes.sql
--
-- Como `cotizaciones.sql`, no necesita las cuentas del seed: entra como el primer
-- usuario activo de Administración que encuentre (y, si hay, como uno de otro
-- rol). Todo dentro de una transacción que termina en ROLLBACK: no deja nada.

begin;

-- ── 1. El esquema y el catálogo sembrado ────────────────────────────────────

do $$
declare
  n integer;
begin
  if exists (
    select 1 from pg_class
     where relname in ('configuracion', 'grupos_plancha', 'formatos_plancha')
       and relnamespace = 'public'::regnamespace and not relrowsecurity
  ) then
    raise exception 'FALLO: falta RLS en las tablas de cortes';
  end if;

  -- Un formato sin grupo no puede existir, y cada código de Odoo es de un solo formato.
  if exists (select 1 from public.formatos_plancha f
              where not exists (select 1 from public.grupos_plancha g where g.id = f.grupo_id)) then
    raise exception 'FALLO: hay formatos huérfanos';
  end if;
  if exists (select 1 from public.grupos_plancha g
              where not exists (select 1 from public.formatos_plancha f where f.grupo_id = g.id)) then
    raise exception 'FALLO: la migración dejó grupos sin ningún formato';
  end if;

  -- Lo que viene de la lista de la empresa. Si el catálogo se editó después, esto
  -- cuenta lo que hay; lo que no puede pasar es que esté vacío.
  select count(*) into n from public.formatos_plancha;
  if n < 1 then raise exception 'FALLO: el catálogo de planchas está vacío'; end if;

  -- Los servicios y las planchas de ejemplo con que se probó el cálculo.
  if not exists (
    select 1 from public.formatos_plancha f join public.grupos_plancha g on g.id = f.grupo_id
     where f.codigo_odoo = 'F7E024' and g.material = 'Acrílico ECO' and g.variante = 'Cristal'
       and g.espesor_mm = 3 and f.ancho_cm = 122 and f.largo_cm = 183
  ) then
    raise notice 'El formato F7E024 (ECO cristal 3 mm, 122×183) ya no está como en la lista original';
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
  id_grupo uuid;
  fila     public.configuracion%rowtype;
begin
  -- 2.1 La configuración se guarda y queda firmada.
  insert into public.configuracion (clave, valor)
  values ('prueba-sql', '{"cobro": {"recargoPct": 25}}'::jsonb)
  on conflict (clave) do update set valor = excluded.valor;
  select * into fila from public.configuracion where clave = 'prueba-sql';
  if fila.actualizado_por::text <> current_setting('plexi.test_admin') then
    raise exception 'FALLO: la configuración no quedó firmada por quien la guardó';
  end if;

  -- 2.2 Un grupo nuevo con su formato.
  insert into public.grupos_plancha (material, variante, detalle, espesor_mm)
  values ('Prueba SQL', 'Cristal', '', 3) returning id into id_grupo;
  insert into public.formatos_plancha (grupo_id, codigo_odoo, ancho_cm, largo_cm)
  values (id_grupo, 'PRUEBA-SQL-1', 122, 244);

  -- 2.3 El mismo material, color y espesor no se repite.
  begin
    insert into public.grupos_plancha (material, variante, detalle, espesor_mm)
    values ('Prueba SQL', 'Cristal', '', 3);
    raise exception 'FALLO: se duplicó un grupo de planchas';
  exception when unique_violation then null; end;

  -- 2.4 Un código de Odoo es de un solo formato.
  begin
    insert into public.formatos_plancha (grupo_id, codigo_odoo, ancho_cm, largo_cm)
    values (id_grupo, 'PRUEBA-SQL-1', 205, 305);
    raise exception 'FALLO: dos formatos comparten código de Odoo';
  exception when unique_violation then null; end;

  -- 2.5 Las medidas y el espesor son positivos.
  begin
    insert into public.formatos_plancha (grupo_id, codigo_odoo, ancho_cm, largo_cm)
    values (id_grupo, 'PRUEBA-SQL-2', 0, 305);
    raise exception 'FALLO: se aceptó una plancha de ancho cero';
  exception when check_violation then null; end;

  -- 2.6 Los interruptores del grupo se pueden cambiar; borrar el grupo se lleva sus formatos.
  update public.grupos_plancha set sobrantes_activo = true, rotable = false where id = id_grupo;
  delete from public.grupos_plancha where id = id_grupo;
  if exists (select 1 from public.formatos_plancha where codigo_odoo = 'PRUEBA-SQL-1') then
    raise exception 'FALLO: borrar el grupo dejó sus formatos';
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
begin
  if current_setting('plexi.test_otro') = '' then return; end if;

  if (select count(*) from public.configuracion) > 0 then
    raise exception 'FALLO: un rol que no es Administración ve la configuración';
  end if;
  -- El catálogo sí lo lee (sin precios: viven en Odoo), para registrar sobrantes
  -- (20261112000100). Escribirlo no.
  if (select count(*) from public.grupos_plancha) = 0 then
    raise exception 'FALLO: otro rol no ve el catálogo de planchas';
  end if;
  update public.formatos_plancha set activo = activo;
  if found then raise exception 'FALLO: otro rol pudo cambiar un formato'; end if;

  begin
    insert into public.configuracion (clave, valor) values ('intrusa', '{}'::jsonb);
    raise exception 'FALLO: otro rol pudo escribir la configuración';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  begin
    insert into public.grupos_plancha (material, espesor_mm) values ('Intruso', 3);
    raise exception 'FALLO: otro rol pudo crear un grupo de planchas';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

set local role postgres;

select 'cortes: todo en orden' as resultado;

rollback;
