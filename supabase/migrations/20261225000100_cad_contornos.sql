-- Contornos vectoriales (logos) extraídos de un PDF para usarlos en un diseño libre.
--
-- El asistente de diseños lee un plano vectorial (la herramienta
-- `extraer_contorno_pdf`, lib/pdf-vector.ts), saca el contorno exacto de un logo y
-- lo guarda aquí con un nombre. El código del diseño libre lo pide por ese
-- nombre (`caras_de_contorno("hurley")` en el sandbox): así no se pegan miles de
-- puntos dentro del código (tope de 60 000 caracteres) y el contorno se puede
-- reutilizar en las piezas del diseño.
--
-- Solo se inserta: un contorno ya guardado no cambia. Si hay que volver a
-- extraerlo, se guarda con otro nombre (`hurley_2`); así una versión vieja del
-- diseño nunca cambia de forma por debajo.
--
-- Permisos como los de `cad_mensajes`: cualquiera con rol (`auth_rol()` no nulo)
-- lee e inserta. Se borra solo al borrar el diseño (cascada).

create table public.cad_contornos (
  id uuid primary key default gen_random_uuid(),
  diseno_id uuid not null references public.cad_disenos (id) on delete cascade,
  -- Con el que lo pide el código: minúsculas, números y guion bajo.
  nombre text not null check (nombre ~ '^[a-z][a-z0-9_]{0,39}$'),
  ancho_mm numeric not null check (ancho_mm > 0),
  alto_mm numeric not null check (alto_mm > 0),
  -- Lista de trazos: cada uno es un `d` de SVG (M, L, C, Z) en milímetros, con el
  -- origen abajo a la izquierda y Y hacia arriba.
  trazos jsonb not null check (
    jsonb_typeof(trazos) = 'array'
    and jsonb_array_length(trazos) between 1 and 5000
    and octet_length(trazos::text) <= 2000000
  ),
  -- De dónde salió: adjunto, página y región (para poder revisarlo).
  origen jsonb,
  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  unique (diseno_id, nombre)
);

comment on table public.cad_contornos is
  'Contorno vectorial (logo) sacado de un PDF, para el diseño libre. Solo inserción: re-extraer crea otro nombre.';
comment on column public.cad_contornos.trazos is
  'Lista de `d` de SVG (M, L, C, Z), en mm, origen abajo a la izquierda, Y hacia arriba.';

alter table public.cad_contornos enable row level security;

create policy cad_contornos_lectura on public.cad_contornos
  for select to authenticated using (public.auth_rol() is not null);
create policy cad_contornos_crear on public.cad_contornos
  for insert to authenticated with check (public.auth_rol() is not null);

revoke all on public.cad_contornos from anon, authenticated;
grant select, insert on public.cad_contornos to authenticated;
