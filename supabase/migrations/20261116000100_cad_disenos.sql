-- Diseños (CAD): lo que se dibuja en /disenos, con su historial y su conversación.
--
-- La geometría NO vive aquí: la calcula el motor CAD (`cad/`, `docs/API_cad.md`) a
-- partir de una plantilla y sus parámetros, y se puede volver a calcular cuando
-- haga falta. Esta base guarda lo que no se puede recalcular:
--
--   cad_disenos            el diseño: su nombre y cuál es su versión vigente
--   cad_diseno_versiones   cada plantilla + parámetros por los que pasó, y si el
--                          cambio vino del formulario o del asistente
--   cad_mensajes           la conversación con el asistente de ese diseño
--
-- Las medidas de `parametros` van en milímetros, como en el motor.

create table public.cad_disenos (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null default 'Diseño sin título' check (btrim(nombre) <> ''),

  -- La versión vigente. 0: recién creado, todavía sin plantilla. La mueve
  -- `guardar_version_diseno`, nunca la app a mano.
  version_actual integer not null default 0 check (version_actual >= 0),

  creado_por     uuid references public.usuarios (id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.cad_disenos is
  'Diseño de /disenos. La geometría la calcula el motor CAD; aquí el nombre y la versión vigente.';

create index cad_disenos_actualizado_en_idx on public.cad_disenos (actualizado_en desc);

create trigger cad_disenos_actualizado_en
  before update on public.cad_disenos
  for each row execute function public.tocar_actualizado_en();

create table public.cad_diseno_versiones (
  id        uuid primary key default gen_random_uuid(),
  diseno_id uuid not null references public.cad_disenos (id) on delete cascade,
  version   integer not null check (version >= 1),

  -- El código de la plantilla del motor ("caja") y la versión de esa plantilla con
  -- que se generó: si el motor la cambia, se sabe con cuál se hizo este diseño.
  plantilla         text not null check (btrim(plantilla) <> ''),
  version_plantilla integer,
  -- Ya normalizados por el motor cuando vienen del asistente. En milímetros.
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object'),

  origen text not null check (origen in ('formulario', 'chat')),

  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en  timestamptz not null default now(),

  unique (diseno_id, version)
);

create table public.cad_mensajes (
  id        uuid primary key default gen_random_uuid(),
  diseno_id uuid not null references public.cad_disenos (id) on delete cascade,

  rol       text not null check (rol in ('usuario', 'asistente')),
  contenido text not null,
  -- Qué herramientas usó el asistente en ese turno y en qué quedó cada una, para
  -- volver a pintarlo al abrir el diseño. Un resumen: nunca la geometría.
  herramientas jsonb check (herramientas is null or jsonb_typeof(herramientas) = 'array'),

  creado_en timestamptz not null default now()
);

create index cad_mensajes_diseno_idx on public.cad_mensajes (diseno_id, creado_en);

-- ── Una versión nueva, numerada sin carreras ────────────────────────────────
-- SECURITY INVOKER, como `crear_cotizacion`: corre con los permisos de quien
-- llama, así que la RLS sigue exigiendo Administración y `auth.uid()` firma la
-- fila.
--
-- El número sale del UPDATE del diseño y no de un `max(version) + 1`: el UPDATE
-- bloquea la fila, así que el formulario y el asistente guardando a la vez se
-- ponen en fila y cada uno recibe su número. El `unique` queda de red.

create function public.guardar_version_diseno(
  p_diseno_id         uuid,
  p_plantilla         text,
  p_parametros        jsonb,
  p_origen            text,
  p_version_plantilla integer default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
begin
  update public.cad_disenos
     set version_actual = version_actual + 1
   where id = p_diseno_id
  returning version_actual into v_version;

  if v_version is null then
    raise exception 'El diseño ya no existe o tu rol no puede cambiarlo.';
  end if;

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen)
  values
    (p_diseno_id, v_version, p_plantilla, p_version_plantilla,
     coalesce(p_parametros, '{}'::jsonb), p_origen);

  return v_version;
end $$;

revoke execute on function public.guardar_version_diseno(uuid, text, jsonb, text, integer)
  from public, anon;
grant execute on function public.guardar_version_diseno(uuid, text, jsonb, text, integer)
  to authenticated;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Por ahora los diseños son de Administración, lo mismo que dice el permiso
-- `usarCad` de la app. Una versión no se corrige ni se borra suelta (se guarda
-- otra); un mensaje tampoco se edita. Las dos se van con su diseño, por cascada.

alter table public.cad_disenos          enable row level security;
alter table public.cad_diseno_versiones enable row level security;
alter table public.cad_mensajes         enable row level security;

create policy cad_disenos_admin on public.cad_disenos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy cad_diseno_versiones_admin on public.cad_diseno_versiones
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy cad_mensajes_admin on public.cad_mensajes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

revoke all on public.cad_disenos, public.cad_diseno_versiones, public.cad_mensajes
  from anon, authenticated;
grant select, insert, update, delete on public.cad_disenos to authenticated;
grant select, insert on public.cad_diseno_versiones to authenticated;
grant select, insert on public.cad_mensajes to authenticated;
