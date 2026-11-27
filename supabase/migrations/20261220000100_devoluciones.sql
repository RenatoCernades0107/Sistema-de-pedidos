-- Devoluciones de dinero al cliente.
--
-- Un abono entra por `pagos`; una devolución es el movimiento inverso y vive en su
-- propia tabla, con su motivo y su método. `pedidos.monto_pagado` pasa a ser lo
-- cobrado NETO (abonos menos devoluciones): así `saldo`, `pagado` y toda la cartera
-- siguen leyendo una sola columna y no hay que enseñarles nada nuevo.
--
-- No es una nota de crédito: no emite ningún documento ni toca Odoo. Es el registro
-- de que se devolvió plata. Una devolución no se edita ni se borra: si se anotó mal,
-- se corrige con un abono por la misma cantidad.

create table public.devoluciones (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid not null references public.pedidos (id) on delete cascade,
  monto          numeric(10, 2) not null check (monto > 0),
  metodo         public.metodo_pago not null,
  motivo         text not null constraint devoluciones_motivo_check check (length(btrim(motivo)) between 1 and 300),
  fecha          timestamptz not null default now(),
  registrado_por uuid references public.usuarios (id)
);

create index devoluciones_pedido_idx on public.devoluciones (pedido_id, fecha);

comment on table public.devoluciones is
  'Plata devuelta al cliente. Restan de pedidos.monto_pagado por trigger; inmutables.';

-- ── El saldo es abonos − devoluciones ────────────────────────────────────────
-- Misma función que ya recalculaba desde `pagos`: recalcula desde la suma real,
-- no acumulando, así que sirve igual para las dos tablas (las dos tienen
-- `pedido_id`).

create or replace function public.recalcular_monto_pagado()
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
    set monto_pagado =
          coalesce((select sum(g.monto) from public.pagos g where g.pedido_id = afectado), 0)
        - coalesce((select sum(d.monto) from public.devoluciones d where d.pedido_id = afectado), 0)
    where p.id = afectado;
  end loop;

  perform public.marcar_escritura_del_sistema(false);
  return null;
end $$;

create trigger devoluciones_recalculan_saldo
  after insert or update or delete on public.devoluciones
  for each row execute function public.recalcular_monto_pagado();

-- No se devuelve más de lo cobrado. `pedidos_monto_pagado_check` ya lo impediría
-- (monto_pagado >= 0), pero con un mensaje que habla de abonos y del total: aquí
-- se dice lo que de verdad pasa. La fila del pedido se bloquea para que dos
-- devoluciones a la vez no se pasen juntas.
--
-- Un trigger BEFORE corre ANTES de que la RLS compruebe la fila, y esta función
-- lee el pedido como dueña. Sin la comprobación de rol de abajo, cualquier sesión
-- (Ventas, el taller…) recibiría en el error cuánto se cobró del pedido y le
-- bloquearía la fila a Administración con solo intentar el INSERT.
create function public.validar_devolucion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cobrado numeric;
begin
  if not public.es_admin() then
    raise exception 'Solo Administración registra devoluciones' using errcode = '42501';
  end if;

  select p.monto_pagado into cobrado
  from public.pedidos p
  where p.id = new.pedido_id
  for update;

  if new.monto > coalesce(cobrado, 0) then
    raise exception 'DEVOLUCION_EXCEDE: solo se cobró S/ %', to_char(coalesce(cobrado, 0), 'FM999999990.00');
  end if;

  return new;
end $$;

create trigger devoluciones_no_exceden_lo_cobrado
  before insert on public.devoluciones
  for each row execute function public.validar_devolucion();

-- ── Permisos ─────────────────────────────────────────────────────────────────
-- Administración registra y lee; Ventas lee (ve los pagos). Nadie actualiza ni borra.

alter table public.devoluciones enable row level security;

create policy devoluciones_admin_lectura on public.devoluciones
  for select to authenticated using (public.es_admin());

create policy devoluciones_admin_alta on public.devoluciones
  for insert to authenticated
  with check (public.es_admin() and registrado_por = auth.uid());

create policy devoluciones_ventas_lectura on public.devoluciones
  for select to authenticated using (public.es_ventas());

revoke all on public.devoluciones from anon, authenticated;
grant select, insert on public.devoluciones to authenticated;

-- Las devoluciones de cada pedido, con el nombre de quien las registró.
create view public.devoluciones_pedido as
select
  d.id,
  d.pedido_id,
  d.monto,
  d.metodo,
  d.motivo,
  d.fecha,
  u.nombre as usuario
from public.devoluciones d
left join public.usuarios u on u.id = d.registrado_por
where public.auth_rol() in ('administracion', 'ventas');

grant select on public.devoluciones_pedido to authenticated;
