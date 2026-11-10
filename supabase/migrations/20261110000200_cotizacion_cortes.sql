-- Cortes dentro de una cotización.
--
-- Hasta ahora cada línea era un producto de Odoo tal cual. Un corte ("10 piezas
-- de 60×80 en acrílico cristal de 3 mm") también es una línea, pero lo que se
-- vende no existe en Odoo: la app calcula cuántas planchas consume y cuánto
-- cuesta cortarlas (`lib/cortes/`), y guarda ese cálculo con la línea.
--
-- En una línea de corte:
--   odoo_product_id   la plancha de la que sale (el formato elegido)
--   cantidad          cuántas planchas se abren: lo que se descuenta del stock
--   precio_unitario   referencial: el material entre las planchas
--   importe           lo que se cobra por la línea entera: material + servicio
--   corte             el cálculo completo: piezas, modalidad, cobro de cada
--                     plancha, desglose y el acomodo para la hoja de corte
--
-- El cálculo se guarda entero, y no se rehace al leer, porque es lo que se le
-- cotizó al cliente: si mañana cambia el precio del corte en Configuración, esta
-- cotización sigue diciendo lo que dijo.

create type public.tipo_linea as enum ('producto', 'corte');

alter table public.cotizacion_productos
  add column tipo    public.tipo_linea not null default 'producto',
  add column corte   jsonb,
  -- En una línea de producto queda en NULL: ahí el importe es cantidad × precio.
  add column importe numeric(12, 2) check (importe >= 0),
  add constraint cotizacion_productos_corte_con_calculo
    check ((tipo = 'corte') = (corte is not null and jsonb_typeof(corte) = 'object')),
  add constraint cotizacion_productos_corte_con_importe
    check (tipo <> 'corte' or importe is not null);

comment on column public.cotizacion_productos.corte is
  'El cálculo del corte tal como se cotizó (lib/cortes/guardado.ts). Solo en las líneas de tipo corte.';

-- ── crear_cotizacion: las líneas pueden traer su corte ──────────────────────
-- La misma función de `20261105000100_cotizaciones.sql`, con la misma firma:
-- solo cambia lo que lee de cada línea del JSON. `create or replace` basta.

create or replace function public.crear_cotizacion(
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
  p_chat_agente_id      text    default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  nuevo_id uuid;
begin
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Una cotización necesita al menos un producto';
  end if;

  insert into public.cotizaciones (
    canal, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_order_id, odoo_order_name, sincronizacion,
    monto_sin_impuestos, monto_impuestos, monto_total,
    notas, chat_agente_id, creado_por
  ) values (
    coalesce(p_canal, 'tienda'), p_odoo_partner_id, btrim(p_cliente_nombre),
    nullif(btrim(p_cliente_documento), ''), nullif(btrim(p_cliente_telefono), ''),
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
    descripcion, cantidad, precio_unitario, tipo, corte, importe
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
    (l.v ->> 'importe')::numeric
  from jsonb_array_elements(p_lineas) with ordinality as l (v, n);

  return nuevo_id;
end $$;
