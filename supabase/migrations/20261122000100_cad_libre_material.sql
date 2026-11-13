-- Diseño libre (CAD) con material y acomodo, igual que las versiones de plantilla.
--
-- `guardar_version_diseno_libre` acepta ahora el material (`grupo_plancha_id`,
-- `color`) y la foto del acomodo en planchas. Como en `guardar_version_diseno`
-- (20261117000100_cad_material.sql): si no se pasa material, se hereda el de la
-- versión anterior; el acomodo no se hereda (el código pudo cambiar la
-- geometría): quien elige material lo recalcula y lo pasa.
--
-- Elegir material guarda el MISMO código como versión nueva. Si la anterior ya
-- estaba aprobada y el código no cambió, la nueva conserva esa aprobación (quién
-- y cuándo): la geometría revisada es la misma. Con otro código nace en borrador,
-- como siempre. Las versiones solo las escribe Administración (RLS), igual que
-- solo ella aprueba.
--
-- La firma cambia (tres argumentos más, con valor por defecto): se cambia la
-- función en vez de añadir otra, para que una llamada con los tres de siempre
-- no sea ambigua entre dos.

drop function if exists public.guardar_version_diseno_libre(uuid, text, text);

create function public.guardar_version_diseno_libre(
  p_diseno_id        uuid,
  p_codigo           text,
  p_origen           text  default 'chat',
  p_grupo_plancha_id uuid  default null,
  p_color            text  default null,
  p_acomodo          jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version  integer;
  v_grupo    uuid := p_grupo_plancha_id;
  v_color    text := nullif(btrim(p_color), '');
  v_anterior public.cad_diseno_versiones%rowtype;
  v_aprobada boolean;
begin
  update public.cad_disenos
     set version_actual = version_actual + 1
   where id = p_diseno_id
  returning version_actual into v_version;

  if v_version is null then
    raise exception 'El diseño ya no existe o tu rol no puede cambiarlo.';
  end if;

  select * into v_anterior
    from public.cad_diseno_versiones
   where diseno_id = p_diseno_id and version = v_version - 1;

  if v_grupo is null then
    v_grupo := v_anterior.grupo_plancha_id;
    v_color := v_anterior.color;
  end if;

  v_aprobada := coalesce(v_anterior.plantilla = 'libre'
                         and v_anterior.estado = 'aprobado'
                         and v_anterior.codigo = p_codigo, false);

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen,
     grupo_plancha_id, color, acomodo, codigo, estado, aprobado_por, aprobado_en)
  values
    (p_diseno_id, v_version, 'libre', null, '{}'::jsonb, p_origen,
     v_grupo, v_color, p_acomodo, p_codigo,
     case when v_aprobada then 'aprobado' else 'borrador' end,
     case when v_aprobada then v_anterior.aprobado_por end,
     case when v_aprobada then v_anterior.aprobado_en end);

  return v_version;
end $$;

revoke execute on function public.guardar_version_diseno_libre(uuid, text, text, uuid, text, jsonb)
  from public, anon;
grant execute on function public.guardar_version_diseno_libre(uuid, text, text, uuid, text, jsonb)
  to authenticated;
