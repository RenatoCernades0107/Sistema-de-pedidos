-- Diseños (CAD): el material de cada versión y su acomodo en planchas.
--
--   grupo_plancha_id  el material / color / espesor del catálogo (`grupos_plancha`)
--   color             el color, solo en grupos con un código compartido entre colores
--   acomodo           foto del acomodo en planchas que se vio al guardar: formato,
--                     planchas con sus piezas (mm), merma. Se puede recalcular; se
--                     guarda para saber qué se mandó a cortar.
--
-- Todo opcional: una versión sin material sigue siendo válida, y quien llama a
-- `guardar_version_diseno` con los cinco argumentos de antes no nota el cambio.
-- Si no pasa material, la versión nueva hereda el de la anterior (el asistente
-- cambia medidas, no la plancha); el acomodo no se hereda: la geometría cambió.

alter table public.cad_diseno_versiones
  add column grupo_plancha_id uuid references public.grupos_plancha (id) on delete set null,
  add column color text check (color is null or btrim(color) <> ''),
  add column acomodo jsonb check (acomodo is null or jsonb_typeof(acomodo) = 'object');

create index cad_diseno_versiones_grupo_idx on public.cad_diseno_versiones (grupo_plancha_id)
  where grupo_plancha_id is not null;

-- La firma cambia (tres argumentos más, con valor por defecto): se cambia la
-- función en vez de añadir otra, para que una llamada con los cinco de siempre
-- no sea ambigua entre dos.
drop function public.guardar_version_diseno(uuid, text, jsonb, text, integer);

create function public.guardar_version_diseno(
  p_diseno_id         uuid,
  p_plantilla         text,
  p_parametros        jsonb,
  p_origen            text,
  p_version_plantilla integer default null,
  p_grupo_plancha_id  uuid    default null,
  p_color             text    default null,
  p_acomodo           jsonb   default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
  v_grupo   uuid := p_grupo_plancha_id;
  v_color   text := nullif(btrim(p_color), '');
begin
  update public.cad_disenos
     set version_actual = version_actual + 1
   where id = p_diseno_id
  returning version_actual into v_version;

  if v_version is null then
    raise exception 'El diseño ya no existe o tu rol no puede cambiarlo.';
  end if;

  if v_grupo is null then
    select grupo_plancha_id, color into v_grupo, v_color
      from public.cad_diseno_versiones
     where diseno_id = p_diseno_id and version = v_version - 1;
  end if;

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen,
     grupo_plancha_id, color, acomodo)
  values
    (p_diseno_id, v_version, p_plantilla, p_version_plantilla,
     coalesce(p_parametros, '{}'::jsonb), p_origen,
     v_grupo, v_color, p_acomodo);

  return v_version;
end $$;

revoke execute on function public.guardar_version_diseno(uuid, text, jsonb, text, integer, uuid, text, jsonb)
  from public, anon;
grant execute on function public.guardar_version_diseno(uuid, text, jsonb, text, integer, uuid, text, jsonb)
  to authenticated;
