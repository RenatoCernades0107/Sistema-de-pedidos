-- Sobrantes: los pedazos de plancha que quedan en el almacén para otro corte.
--
-- En Odoo cada sobrante es un lote de un producto "Sobrante" de su material, con
-- su largo y su ancho (`x_largo`, `x_ancho`) y una unidad en stock. Esta tabla es
-- su espejo en la app, por dos motivos:
--   - El cálculo de un corte necesita los sobrantes al ritmo del teclado, sin
--     preguntarle a Odoo en cada tecla.
--   - Un sobrante se reserva para un pedido al registrarlo (Fase 5b), y Odoo no
--     sabe de esa reserva hasta que la orden de fabricación existe: aquí se evita
--     que dos pedidos cuenten con la misma pieza.
--
-- Lo que manda es Odoo: "Sincronizar con Odoo" reconcilia esta tabla con su stock.

create type public.estado_sobrante as enum ('disponible', 'reservado', 'consumido', 'baja');

create sequence public.sobrantes_numero_seq;

create table public.sobrantes (
  id uuid primary key default gen_random_uuid(),

  -- El nombre del lote en Odoo y lo que dice la etiqueta: SOB-00042.
  codigo text not null unique
    default ('SOB-' || lpad(nextval('public.sobrantes_numero_seq')::text, 5, '0')),

  grupo_id uuid not null references public.grupos_plancha (id) on delete restrict,
  -- El color de la pieza, si el grupo es de los que comparten código entre colores.
  color text check (color is null or btrim(color) <> ''),

  -- El largo es el lado mayor: así "61×183" y "183×61" son el mismo sobrante.
  largo_cm numeric(7, 2) not null check (largo_cm > 0),
  ancho_cm numeric(7, 2) not null check (ancho_cm > 0),
  check (largo_cm >= ancho_cm),

  -- Dónde está, en palabras: "Rack 2, fila B".
  ubicacion text check (ubicacion is null or btrim(ubicacion) <> ''),

  estado public.estado_sobrante not null default 'disponible',
  -- Media o cuarto de un formato del grupo: se usa al final, porque se vende entero.
  estandar boolean not null default false,
  -- Para quién está reservado o en qué pedido se consumió.
  pedido_id uuid references public.pedidos (id) on delete set null,

  -- Cómo llegó: registrado a mano, nacido de un corte, o encontrado en Odoo.
  origen text not null default 'manual' check (origen in ('manual', 'corte', 'odoo')),

  odoo_lot_id integer unique,
  sincronizacion public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text,

  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Un lote traído de Odoo conserva su nombre. Si tiene la forma de los de la app
-- (SOB-00042, creado en otra base o antes de esta tabla), la numeración salta por
-- encima: si no, el próximo sobrante registrado aquí chocaría con él.
create function public.sobrantes_saltar_numeracion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_numero bigint;
begin
  if new.codigo ~ '^SOB-[0-9]{1,15}$' then
    v_numero := substring(new.codigo from 5)::bigint;
    if v_numero > (select last_value from public.sobrantes_numero_seq) then
      perform setval('public.sobrantes_numero_seq', v_numero);
    end if;
  end if;
  return new;
end $$;

create trigger sobrantes_saltar_numeracion
  before insert on public.sobrantes
  for each row execute function public.sobrantes_saltar_numeracion();

create index sobrantes_grupo_estado_idx on public.sobrantes (grupo_id, estado);

create trigger sobrantes_actualizado_en
  before update on public.sobrantes
  for each row execute function public.tocar_actualizado_en();

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Los sobrantes los ven y los registran los tres roles: el taller es quien los
-- mide y los guarda. Borrar una fila no: un sobrante que ya no está se marca.

alter table public.sobrantes enable row level security;

create policy sobrantes_lectura on public.sobrantes
  for select to authenticated using (public.auth_rol() is not null);
create policy sobrantes_alta on public.sobrantes
  for insert to authenticated with check (public.auth_rol() is not null);
create policy sobrantes_cambios on public.sobrantes
  for update to authenticated using (public.auth_rol() is not null) with check (public.auth_rol() is not null);

revoke all on public.sobrantes from anon, authenticated;
grant select, insert, update on public.sobrantes to authenticated;
revoke all on sequence public.sobrantes_numero_seq from anon;
grant usage on sequence public.sobrantes_numero_seq to authenticated;

-- Para registrar un sobrante hay que elegir su material: el catálogo de planchas
-- (sin precios: el precio vive en Odoo) lo leen ahora todos los roles. Escribirlo
-- sigue siendo de Administración.
create policy grupos_plancha_lectura on public.grupos_plancha
  for select to authenticated using (public.auth_rol() is not null);
create policy formatos_plancha_lectura on public.formatos_plancha
  for select to authenticated using (public.auth_rol() is not null);

-- El lado mínimo de un sobrante, de la configuración de cortes. La
-- configuración es de Administración; esto es lo único que el taller necesita
-- de ella.
create function public.retazo_minimo()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (valor -> 'corte' ->> 'retazoMin')::numeric from public.configuracion where clave = 'cortes'),
    30
  )
  where public.auth_rol() is not null
$$;

revoke execute on function public.retazo_minimo() from public, anon;
grant execute on function public.retazo_minimo() to authenticated;
