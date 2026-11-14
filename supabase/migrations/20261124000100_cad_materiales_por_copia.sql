-- Diseños (CAD): material propio por copia de pieza.
--
--   materiales  {"porCopia": {"<nodo>": {"material", "variante", "detalle", "color"}}}
--               El material de cada copia que no usa el del diseño, por nombre de
--               nodo del GLB (`lateral_2`). Es un material sin espesor: la plancha
--               de cada copia es el grupo del catálogo con ese material y el espesor
--               de la pieza. `grupo_plancha_id` / `color` siguen siendo el material
--               del diseño (cotizaciones, terminados y hoja de corte no cambian).
--
-- El espesor propio de una copia NO va aquí: cambia la geometría y viaja en los
-- parámetros (`"espesor@<nodo>": mm`), que el motor aplica.
--
-- `acomodo` pasa a guardar un acomodo por grupo de plancha
-- (`{"version": 2, "kerfMm", "areaPiezasMm2", "grupos": [...]}`); las filas de
-- antes (un solo acomodo) se siguen leyendo (`lib/cad/materiales.ts`).
--
-- Herencia, como el material: si no se pasa `p_materiales` y tampoco material,
-- la versión nueva hereda los de la anterior. Si se pasa `p_materiales`, manda.

alter table public.cad_diseno_versiones
  add column materiales jsonb
    check (materiales is null or (jsonb_typeof(materiales) = 'object'
                                  and jsonb_typeof(coalesce(materiales -> 'porCopia', '{}'::jsonb)) = 'object'));

drop function public.guardar_version_diseno(uuid, text, jsonb, text, integer, uuid, text, jsonb);

create function public.guardar_version_diseno(
  p_diseno_id         uuid,
  p_plantilla         text,
  p_parametros        jsonb,
  p_origen            text,
  p_version_plantilla integer default null,
  p_grupo_plancha_id  uuid    default null,
  p_color             text    default null,
  p_acomodo           jsonb   default null,
  p_materiales        jsonb   default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version    integer;
  v_grupo      uuid  := p_grupo_plancha_id;
  v_color      text  := nullif(btrim(p_color), '');
  v_materiales jsonb := p_materiales;
  v_anterior   public.cad_diseno_versiones%rowtype;
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
    if v_materiales is null then
      v_materiales := v_anterior.materiales;
    end if;
  end if;

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen,
     grupo_plancha_id, color, acomodo, materiales)
  values
    (p_diseno_id, v_version, p_plantilla, p_version_plantilla,
     coalesce(p_parametros, '{}'::jsonb), p_origen,
     v_grupo, v_color, p_acomodo, v_materiales);

  return v_version;
end $$;

revoke execute on function public.guardar_version_diseno(uuid, text, jsonb, text, integer, uuid, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.guardar_version_diseno(uuid, text, jsonb, text, integer, uuid, text, jsonb, jsonb)
  to authenticated;

drop function public.guardar_version_diseno_libre(uuid, text, text, uuid, text, jsonb);

create function public.guardar_version_diseno_libre(
  p_diseno_id        uuid,
  p_codigo           text,
  p_origen           text  default 'chat',
  p_grupo_plancha_id uuid  default null,
  p_color            text  default null,
  p_acomodo          jsonb default null,
  p_materiales       jsonb default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version    integer;
  v_grupo      uuid  := p_grupo_plancha_id;
  v_color      text  := nullif(btrim(p_color), '');
  v_materiales jsonb := p_materiales;
  v_anterior   public.cad_diseno_versiones%rowtype;
  v_aprobada   boolean;
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
    if v_materiales is null then
      v_materiales := v_anterior.materiales;
    end if;
  end if;

  v_aprobada := coalesce(v_anterior.plantilla = 'libre'
                         and v_anterior.estado = 'aprobado'
                         and v_anterior.codigo = p_codigo, false);

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen,
     grupo_plancha_id, color, acomodo, materiales, codigo, estado, aprobado_por, aprobado_en)
  values
    (p_diseno_id, v_version, 'libre', null, '{}'::jsonb, p_origen,
     v_grupo, v_color, p_acomodo, v_materiales, p_codigo,
     case when v_aprobada then 'aprobado' else 'borrador' end,
     case when v_aprobada then v_anterior.aprobado_por end,
     case when v_aprobada then v_anterior.aprobado_en end);

  return v_version;
end $$;

revoke execute on function public.guardar_version_diseno_libre(uuid, text, text, uuid, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.guardar_version_diseno_libre(uuid, text, text, uuid, text, jsonb, jsonb)
  to authenticated;
