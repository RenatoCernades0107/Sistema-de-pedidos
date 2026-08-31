-- Abonos del cliente. `pedidos.monto_pagado` es su suma; nadie lo escribe a mano.

create table public.pagos (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid not null references public.pedidos (id) on delete cascade,
  monto          numeric(10, 2) not null check (monto > 0),
  metodo         public.metodo_pago not null,
  fecha          timestamptz not null default now(),
  registrado_por uuid references public.usuarios (id),
  nota           text
);

create index pagos_pedido_idx on public.pagos (pedido_id, fecha);

-- Marca de "esta escritura la hace el sistema, no una persona".
--
-- El trigger que recalcula el saldo tiene que actualizar `pedidos.monto_pagado`,
-- una columna que ningún rol puede tocar. La marca es transaction-local
-- (set_config con is_local = true), así que no sobrevive al commit ni se filtra a
-- otra sesión: no es un permiso, es un paréntesis.
create function public.marcar_escritura_del_sistema(activa boolean)
returns void
language sql
as $$
  select set_config('plexi.interno', case when activa then 'on' else 'off' end, true)
$$;

create function public.escritura_del_sistema()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('plexi.interno', true), 'off') = 'on'
$$;

-- Recalcula desde la suma real, no acumulando: así un DELETE o la corrección de
-- un abono no dejan el total desincronizado para siempre.
create function public.recalcular_monto_pagado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids      uuid[] := '{}';
  afectado uuid;
begin
  -- En un trigger de INSERT no existe OLD, y en uno de DELETE no existe NEW:
  -- tocar el que no corresponde aborta la transacción.
  if tg_op in ('INSERT', 'UPDATE') then ids := ids || new.pedido_id; end if;
  if tg_op in ('UPDATE', 'DELETE') then ids := ids || old.pedido_id; end if;

  perform public.marcar_escritura_del_sistema(true);

  for afectado in select distinct x from unnest(ids) as t(x)
  loop
    update public.pedidos p
    set monto_pagado = coalesce(
      (select sum(g.monto) from public.pagos g where g.pedido_id = afectado), 0
    )
    where p.id = afectado;
  end loop;

  perform public.marcar_escritura_del_sistema(false);
  return null;
end $$;

create trigger pagos_recalculan_saldo
  after insert or update or delete on public.pagos
  for each row execute function public.recalcular_monto_pagado();
