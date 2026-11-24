-- Quién atiende por la empresa. El contacto vive en Odoo (un `res.partner` hijo de
-- la empresa); aquí queda su copia, como el teléfono: lo que se cotizó a quién,
-- aunque después lo editen o lo archiven en Odoo.
--
-- `cliente_telefono` sigue siendo el teléfono con el que se contacta: el de la
-- persona si la hay, y si no, el de la empresa.

alter table public.cotizaciones
  add column odoo_contacto_id integer,
  add column contacto_nombre  text;

alter table public.cotizaciones
  add constraint cotizaciones_contacto_completo
  check ((odoo_contacto_id is null) = (contacto_nombre is null));

-- ── crear_cotizacion: dos argumentos más, al final ──────────────────────────
-- Agregar argumentos deja la función anterior viva como sobrecarga y PostgREST
-- no sabe a cuál llamar: se borra y se crea con los permisos de siempre.

drop function public.crear_cotizacion(
  integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text,
  numeric, numeric, numeric, text
);

create function public.crear_cotizacion(
  p_odoo_partner_id     integer,
  p_cliente_nombre      text,
  p_lineas              jsonb,
  p_canal               public.canal_cotizacion default 'tienda',
  p_cliente_documento   text    default null,
  p_cliente_telefono    text    default null,
  p_notas               text    default null,
  p_odoo_order_id       integer default null,
  p_odoo_order_name     text    default null,
  p_monto_sin_impuestos numeric default null,
  p_monto_impuestos     numeric default null,
  p_monto_total         numeric default null,
  p_chat_agente_id      text    default null,
  p_odoo_contacto_id    integer default null,
  p_contacto_nombre     text    default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  nuevo_id uuid;
  contacto text := nullif(btrim(p_contacto_nombre), '');
begin
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Una cotización necesita al menos un producto';
  end if;

  insert into public.cotizaciones (
    canal, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_contacto_id, contacto_nombre,
    odoo_order_id, odoo_order_name, sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total,
    notas, chat_agente_id, creado_por
  ) values (
    coalesce(p_canal, 'tienda'), p_odoo_partner_id, btrim(p_cliente_nombre),
    nullif(btrim(p_cliente_documento), ''), nullif(btrim(p_cliente_telefono), ''),
    -- Un contacto sin nombre no se guarda: el CHECK pide las dos cosas o ninguna.
    case when contacto is not null then p_odoo_contacto_id end, case when p_odoo_contacto_id is not null then contacto end,
    p_odoo_order_id, p_odoo_order_name,
    case when p_odoo_order_id is null then 'pendiente' else 'sincronizada' end::public.sincronizacion_odoo,
    p_monto_sin_impuestos, p_monto_impuestos, p_monto_total,
    nullif(btrim(p_notas), ''), p_chat_agente_id, auth.uid()
  )
  on conflict (odoo_order_id) do nothing
  returning id into nuevo_id;

  if nuevo_id is null then
    select id into nuevo_id from public.cotizaciones where odoo_order_id = p_odoo_order_id;
    return nuevo_id;
  end if;

  insert into public.cotizacion_productos (
    cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo,
    descripcion, cantidad, precio_unitario, tipo, corte, terminado, importe,
    diseno_version_id
  )
  select
    nuevo_id,
    l.n::smallint,
    (l.v ->> 'odoo_product_id')::integer,
    btrim(l.v ->> 'producto_nombre'),
    nullif(btrim(l.v ->> 'producto_codigo'), ''),
    nullif(btrim(l.v ->> 'descripcion'), ''),
    (l.v ->> 'cantidad')::numeric,
    (l.v ->> 'precio_unitario')::numeric,
    coalesce(nullif(l.v ->> 'tipo', ''), 'producto')::public.tipo_linea,
    case when jsonb_typeof(l.v -> 'corte') = 'object' then l.v -> 'corte' end,
    case when jsonb_typeof(l.v -> 'terminado') = 'object' then l.v -> 'terminado' end,
    (l.v ->> 'importe')::numeric,
    nullif(l.v ->> 'diseno_version_id', '')::uuid
  from jsonb_array_elements(p_lineas) with ordinality as l (v, n);

  return nuevo_id;
end $$;

revoke execute on function public.crear_cotizacion(
  integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text,
  numeric, numeric, numeric, text, integer, text
) from public, anon;
grant execute on function public.crear_cotizacion(
  integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text,
  numeric, numeric, numeric, text, integer, text
) to authenticated;
