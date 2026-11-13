-- Diseño libre (CAD): versiones hechas con código build123d en vez de plantilla.
--
-- Cuando ninguna plantilla sirve, el asistente escribe código que corre en el
-- sandbox (`cad/sandbox/`). Esa versión guarda el CÓDIGO (la geometría se vuelve a
-- calcular ejecutándolo) con `plantilla = 'libre'` y `parametros = {}`, así que
-- todo lo que ya lee `plantilla`/`parametros` sigue funcionando.
--
-- Un diseño libre nace en 'borrador' y no se exporta a producción (DXF) hasta que
-- Administración lo aprueba. Las versiones de plantilla nacen 'aprobado': las
-- plantillas ya están revisadas.
--
-- Va DESPUÉS de 20261117000100_cad_material.sql y se compone con ella: no toca
-- `guardar_version_diseno`, crea funciones nuevas.

alter table public.cad_diseno_versiones
  add column if not exists codigo      text,
  add column if not exists estado      text not null default 'aprobado',
  add column if not exists aprobado_por uuid references public.usuarios (id),
  add column if not exists aprobado_en  timestamptz;

alter table public.cad_diseno_versiones
  drop constraint if exists cad_diseno_versiones_estado_check,
  add constraint cad_diseno_versiones_estado_check check (estado in ('borrador', 'aprobado')),
  drop constraint if exists cad_diseno_versiones_libre_check,
  -- 'libre' si y solo si hay código; y el código, acotado.
  add constraint cad_diseno_versiones_libre_check check (
    (plantilla = 'libre') = (codigo is not null)
    and (codigo is null or (btrim(codigo) <> '' and length(codigo) <= 60000))
  ),
  drop constraint if exists cad_diseno_versiones_aprobado_check,
  add constraint cad_diseno_versiones_aprobado_check check (
    estado = 'aprobado' or (aprobado_por is null and aprobado_en is null)
  );

comment on column public.cad_diseno_versiones.codigo is
  'Diseño libre: código build123d que ejecuta el sandbox. Null en las versiones de plantilla.';
comment on column public.cad_diseno_versiones.estado is
  'borrador | aprobado. Un diseño libre no se exporta a producción hasta que lo aprueba Administración.';

-- ── Guardar una versión libre ───────────────────────────────────────────────
-- Igual que `guardar_version_diseno` (numeración sin carreras, SECURITY INVOKER:
-- la RLS sigue exigiendo Administración) pero con código y en borrador. Hereda
-- el material de la versión anterior.

create or replace function public.guardar_version_diseno_libre(
  p_diseno_id uuid,
  p_codigo    text,
  p_origen    text default 'chat'
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
  v_grupo   uuid;
  v_color   text;
begin
  update public.cad_disenos
     set version_actual = version_actual + 1
   where id = p_diseno_id
  returning version_actual into v_version;

  if v_version is null then
    raise exception 'El diseño ya no existe o tu rol no puede cambiarlo.';
  end if;

  select grupo_plancha_id, color into v_grupo, v_color
    from public.cad_diseno_versiones
   where diseno_id = p_diseno_id and version = v_version - 1;

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen,
     grupo_plancha_id, color, codigo, estado)
  values
    (p_diseno_id, v_version, 'libre', null, '{}'::jsonb, p_origen,
     v_grupo, v_color, p_codigo, 'borrador');

  return v_version;
end $$;

revoke execute on function public.guardar_version_diseno_libre(uuid, text, text) from public, anon;
grant execute on function public.guardar_version_diseno_libre(uuid, text, text) to authenticated;

-- ── Aprobar una versión libre ───────────────────────────────────────────────
-- Las versiones no se pueden actualizar desde la app (solo select/insert), así
-- que la aprobación pasa por aquí: SECURITY DEFINER para poder hacer el UPDATE,
-- con la comprobación de Administración explícita y tocando solo el estado.

create or replace function public.aprobar_version_diseno(
  p_diseno_id uuid,
  p_version   integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo Administración puede aprobar diseños.';
  end if;

  update public.cad_diseno_versiones
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now()
   where diseno_id = p_diseno_id and version = p_version and estado = 'borrador';

  if not found then
    raise exception 'Esa versión no existe o ya estaba aprobada.';
  end if;
end $$;

revoke execute on function public.aprobar_version_diseno(uuid, integer) from public, anon;
grant execute on function public.aprobar_version_diseno(uuid, integer) to authenticated;
