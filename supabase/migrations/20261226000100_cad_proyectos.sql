-- Proyectos de diseños: agrupan varios diseños de un mismo trabajo.
--
-- Una lámina de un cliente puede traer varios letreros (o varias cajas, varios
-- displays). Cada uno es un diseño con su propia conversación, pero se aprueban y
-- se mandan a cortar juntos, así que se agrupan en un proyecto.
--
--   · `cad_proyectos`          el proyecto: solo su nombre.
--   · `cad_disenos.proyecto_id` a qué proyecto pertenece un diseño (null: suelto),
--                               y `orden` dentro del proyecto.
--   · `aprobar_proyecto`        aprueba de una vez la versión vigente de todos los
--                               diseños libres del proyecto que sigan en borrador.
--
-- Borrar un proyecto NO borra sus diseños: quedan sueltos (`on delete set null`).
-- Permisos como los de `cad_disenos` (migración 20261129000300): cualquiera con rol
-- lee, crea y edita; borrar es de quien lo creó o de Administración. Aprobar, solo
-- Administración, y lo comprueba la base (no la pantalla).

create table public.cad_proyectos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (btrim(nombre) <> '' and char_length(nombre) <= 120),
  creado_por     uuid references public.usuarios (id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.cad_proyectos is
  'Proyecto de /disenos: agrupa varios diseños de un mismo trabajo para aprobarlos y cortarlos juntos.';

create trigger cad_proyectos_actualizado_en
  before update on public.cad_proyectos
  for each row execute function public.tocar_actualizado_en();

alter table public.cad_disenos
  add column proyecto_id uuid references public.cad_proyectos (id) on delete set null,
  add column orden integer check (orden is null or orden >= 1);

comment on column public.cad_disenos.proyecto_id is
  'Proyecto al que pertenece el diseño. Null: diseño suelto. Borrar el proyecto lo deja suelto.';
comment on column public.cad_disenos.orden is
  'Posición dentro del proyecto (desde 1). Null si el diseño no está en un proyecto.';

create index cad_disenos_proyecto_idx on public.cad_disenos (proyecto_id, orden)
  where proyecto_id is not null;

-- ── Permisos ────────────────────────────────────────────────────────────────

alter table public.cad_proyectos enable row level security;

create policy cad_proyectos_lectura on public.cad_proyectos
  for select to authenticated using (public.auth_rol() is not null);
create policy cad_proyectos_crear on public.cad_proyectos
  for insert to authenticated with check (public.auth_rol() is not null);
create policy cad_proyectos_editar on public.cad_proyectos
  for update to authenticated
  using (public.auth_rol() is not null) with check (public.auth_rol() is not null);
create policy cad_proyectos_borrar on public.cad_proyectos
  for delete to authenticated
  using (public.es_admin() or (public.auth_rol() is not null and creado_por = auth.uid()));

revoke all on public.cad_proyectos from anon, authenticated;
grant select, insert, update, delete on public.cad_proyectos to authenticated;

-- ── Aprobar todo el proyecto ────────────────────────────────────────────────
-- Las versiones no se pueden actualizar desde la app (solo select/insert), así que
-- la aprobación pasa por aquí, como `aprobar_version_diseno`: SECURITY DEFINER,
-- Administración comprobada explícitamente y tocando solo el estado. Aprueba la
-- versión VIGENTE de cada diseño libre en borrador y devuelve cuántas fueron; los
-- de plantilla (que nacen aprobados), los ya aprobados y los que aún no tienen
-- versión no cuentan ni fallan. Si alguien guarda otra versión después, esa vuelve
-- a nacer en borrador: lo aprobado es exactamente lo que había en este momento.

create function public.aprobar_proyecto(p_proyecto uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aprobadas integer;
begin
  if not public.es_admin() then
    raise exception 'Solo Administración puede aprobar diseños.';
  end if;
  if not exists (select 1 from public.cad_proyectos where id = p_proyecto) then
    raise exception 'Ese proyecto no existe.';
  end if;

  update public.cad_diseno_versiones v
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now()
    from public.cad_disenos d
   where d.proyecto_id = p_proyecto
     and v.diseno_id = d.id
     and v.version = d.version_actual
     and v.plantilla = 'libre'
     and v.estado = 'borrador';

  get diagnostics v_aprobadas = row_count;
  return v_aprobadas;
end $$;

revoke execute on function public.aprobar_proyecto(uuid) from public, anon;
grant execute on function public.aprobar_proyecto(uuid) to authenticated;
