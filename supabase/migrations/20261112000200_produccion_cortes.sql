-- La producción de los cortes con el piloto de sobrantes encendido.
--
-- Con piloto, cada corte de un pedido es una orden de fabricación en Odoo: se
-- crea al confirmar el pedido y se cierra al pasar a Listo, con las planchas que
-- de verdad se usaron y los sobrantes que de verdad se guardaron. Esta migración:
--   1. Anota en cada línea de corte su orden y si ya se cerró.
--   2. Liga cada sobrante nacido de un corte con la línea de la que salió.
--   3. `anotar_produccion()`, para escribir el punto 1 desde cualquier rol (el
--      taller cierra la orden al pasar a Listo y no escribe en `cotizaciones`).
--   4. `lineas_de_pedido()` devuelve también el punto 1.

-- ── 1. La orden de cada corte ───────────────────────────────────────────────

alter table public.cotizacion_productos
  add column odoo_produccion_id integer,
  add column odoo_produccion_nombre text,
  add column produccion_cerrada boolean not null default false;

-- ── 2. De qué corte salió un sobrante ───────────────────────────────────────

alter table public.sobrantes
  -- La posición de la línea de corte, dentro del pedido (`pedido_id`).
  add column linea_posicion smallint;

-- ── 3. Anotar la orden ──────────────────────────────────────────────────────

create function public.anotar_produccion(
  p_cotizacion uuid,
  p_posicion   smallint,
  p_id         integer default null,
  p_nombre     text default null,
  p_cerrada    boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede anotar la producción';
  end if;

  update public.cotizacion_productos cp
     set odoo_produccion_id     = coalesce(p_id, cp.odoo_produccion_id),
         odoo_produccion_nombre = coalesce(nullif(btrim(p_nombre), ''), cp.odoo_produccion_nombre),
         -- Cerrada no vuelve atrás: un reintento que falla no la reabre.
         produccion_cerrada     = cp.produccion_cerrada or coalesce(p_cerrada, false)
   where cp.cotizacion_id = p_cotizacion
     and cp.posicion = p_posicion
     and cp.tipo = 'corte';

  if not found then
    raise exception 'Esa línea no es un corte de esa cotización';
  end if;
end $$;

-- ── 4. lineas_de_pedido ─────────────────────────────────────────────────────
-- Cambia lo que devuelve, y eso no lo permite `create or replace`.

drop function public.lineas_de_pedido(text);

create function public.lineas_de_pedido(p_codigo text)
returns table (
  posicion               smallint,
  tipo                   public.tipo_linea,
  odoo_product_id        integer,
  producto_nombre        text,
  producto_codigo        text,
  descripcion            text,
  cantidad               numeric,
  planchas_usadas        numeric,
  corte                  jsonb,
  precio_unitario        numeric,
  importe                numeric,
  odoo_produccion_id     integer,
  odoo_produccion_nombre text,
  produccion_cerrada     boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    cp.posicion, cp.tipo, cp.odoo_product_id, cp.producto_nombre, cp.producto_codigo,
    cp.descripcion, cp.cantidad, cp.planchas_usadas,
    case
      when cp.corte is null then null
      when public.es_admin() then cp.corte
      else public.corte_sin_precios(cp.corte)
    end,
    case when public.es_admin() then cp.precio_unitario end,
    case when public.es_admin() then cp.importe end,
    cp.odoo_produccion_id, cp.odoo_produccion_nombre, cp.produccion_cerrada
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  join public.cotizacion_productos cp on cp.cotizacion_id = c.id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
  order by cp.posicion
$$;

revoke execute on function public.lineas_de_pedido(text) from public, anon;
revoke execute on function public.anotar_produccion(uuid, smallint, integer, text, boolean) from public, anon;
grant execute on function public.lineas_de_pedido(text) to authenticated;
grant execute on function public.anotar_produccion(uuid, smallint, integer, text, boolean) to authenticated;
