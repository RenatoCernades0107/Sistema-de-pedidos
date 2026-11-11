-- El stock al terminar el pedido, y la reserva al anularlo.
--
-- `20261110000300` dejó las columnas para anotar las planchas usadas y si el
-- stock ya bajó. Esta migración completa lo que falta para que la app las use:
--   1. Si la venta de un pedido anulado se canceló en Odoo (y si no, por qué).
--   2. `anotar_stock_de_pedido` también da por confirmada la venta: para
--      descontar, la app la confirma antes si hacía falta.
--   3. `anotar_anulacion_en_odoo`, que escribe el punto 1 desde cualquier rol.
--   4. `odoo_de_pedido` devuelve también lo del punto 1.

-- ── 1. La cancelación en Odoo ───────────────────────────────────────────────

alter table public.cotizaciones
  -- Si la venta se canceló en Odoo porque el pedido se anuló: la reserva de
  -- planchas quedó libre.
  add column anulada_en_odoo boolean not null default false,
  -- Por qué no se pudo cancelar, hasta que alguien reintente.
  add column error_anulacion text;

grant update (anulada_en_odoo, error_anulacion) on public.cotizaciones to authenticated;

-- ── 2. Descontar también confirma ───────────────────────────────────────────
-- Misma firma que en `20261110000300`. Si el stock bajó, la venta está
-- confirmada en Odoo por fuerza: sin confirmar no hay entrega que validar.

create or replace function public.anotar_stock_de_pedido(p_codigo text, p_descontado boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_descontado boolean := coalesce(p_descontado, false);
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede anotar el stock';
  end if;

  update public.cotizaciones c
     set stock_descontado   = c.stock_descontado or v_descontado,
         error_stock        = case when v_descontado then null else nullif(btrim(p_error), '') end,
         confirmada_en_odoo = c.confirmada_en_odoo or v_descontado,
         error_confirmacion = case when v_descontado then null else c.error_confirmacion end
    from public.pedidos p
   where c.pedido_id = p.id
     and p.codigo = p_codigo;
end $$;

-- ── 3. Anotar la cancelación ────────────────────────────────────────────────
-- Lo escribe la app después de cancelar la venta en Odoo, con la sesión de quien
-- anuló el pedido. Igual que el stock: el que anula no siempre escribe en
-- `cotizaciones`.

create function public.anotar_anulacion_en_odoo(p_codigo text, p_anulada boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anulada boolean := coalesce(p_anulada, false);
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede anotar la anulación';
  end if;

  update public.cotizaciones c
     set anulada_en_odoo = c.anulada_en_odoo or v_anulada,
         error_anulacion = case when v_anulada then null else nullif(btrim(p_error), '') end
    from public.pedidos p
   where c.pedido_id = p.id
     and p.codigo = p_codigo
     and p.estado = 'anulado';
end $$;

-- ── 4. odoo_de_pedido ───────────────────────────────────────────────────────
-- Cambia lo que devuelve, y eso no lo permite `create or replace`.

drop function public.odoo_de_pedido(text);

create function public.odoo_de_pedido(p_codigo text)
returns table (
  cotizacion_id      uuid,
  odoo_order_id      integer,
  odoo_order_name    text,
  sincronizacion     public.sincronizacion_odoo,
  confirmada_en_odoo boolean,
  stock_descontado   boolean,
  error_stock        text,
  anulada_en_odoo    boolean,
  error_anulacion    text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.odoo_order_id, c.odoo_order_name, c.sincronizacion,
         c.confirmada_en_odoo, c.stock_descontado, c.error_stock,
         c.anulada_en_odoo, c.error_anulacion
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
$$;

revoke execute on function public.odoo_de_pedido(text) from public, anon;
revoke execute on function public.anotar_anulacion_en_odoo(text, boolean, text) from public, anon;

grant execute on function public.odoo_de_pedido(text) to authenticated;
grant execute on function public.anotar_anulacion_en_odoo(text, boolean, text) to authenticated;
