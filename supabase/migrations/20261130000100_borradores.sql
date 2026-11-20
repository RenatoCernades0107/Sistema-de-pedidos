-- Borradores de pedidos y cotizaciones.
--
-- Mientras se llena "Nuevo pedido" o "Nueva cotización", el formulario entero
-- se va guardando aquí solo. Si quien lo llenaba sale, lo retoma desde la lista.
--
-- Cada borrador es de quien lo creó: nadie más lo ve. Vence a las 48 h sin
-- abrirlo ni editarlo (`vence_en` se renueva en cada update) y un job lo borra.
-- Las consultas filtran además por `vence_en`, así uno vencido no se ve aunque
-- el job todavía no haya pasado.

create table public.borradores (
  id             uuid        primary key default gen_random_uuid(),
  tipo           text        not null check (tipo in ('pedido', 'cotizacion')),
  creado_por     uuid        not null default auth.uid() references public.usuarios (id) on delete cascade,
  -- El pedido que sale de una cotización: de ella toma cliente y productos.
  cotizacion_id  uuid        references public.cotizaciones (id) on delete cascade,
  -- El formulario tal cual, para volver a abrirlo.
  datos          jsonb       not null,
  -- Lo que muestra la lista (cliente, productos, total) sin leer `datos`.
  resumen        jsonb       not null default '{}'::jsonb,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  vence_en       timestamptz not null default now() + interval '48 hours'
);

comment on table public.borradores is
  'Pedidos y cotizaciones a medio llenar. Solo los ve quien los creó; vencen a las 48 h sin uso.';

create index borradores_dueno_idx on public.borradores (creado_por, tipo, vence_en desc);

-- Cada update (guardar o solo abrirlo) renueva las 48 h.
create function public.renovar_borrador()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.vence_en := now() + interval '48 hours';
  -- El dueño no cambia.
  new.creado_por := old.creado_por;
  return new;
end;
$$;

create trigger borradores_renovar
  before update on public.borradores
  for each row execute function public.renovar_borrador();

alter table public.borradores enable row level security;

create policy borradores_propios on public.borradores
  for all to authenticated
  using (creado_por = auth.uid())
  with check (creado_por = auth.uid());

grant select, insert, update, delete on public.borradores to authenticated;

-- ── Limpieza ────────────────────────────────────────────────────────────────

create function public.purgar_borradores()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.borradores where vence_en < now();
$$;

revoke execute on function public.purgar_borradores() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purgar-borradores');
exception when others then null;
end $$;

select cron.schedule('purgar-borradores', '23 * * * *', 'select public.purgar_borradores()');
