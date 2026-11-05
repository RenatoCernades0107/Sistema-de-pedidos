-- Cotizaciones: lo que se le cotiza a un cliente, con su espejo en Odoo.
--
-- El cliente y los productos NO viven aquí: los manda Odoo. Esta base guarda la
-- relación (qué cliente, qué productos, cuánto de cada uno) y la cotización de
-- Odoo con la que se corresponde, 1 a 1:
--
--   cotizaciones          N:1  res.partner   (odoo_partner_id)
--   cotizacion_productos  N:N  product.product (odoo_product_id, una fila por línea)
--   cotizaciones          1:1  sale.order    (odoo_order_id, único)
--
-- Del cliente y de cada producto se guarda además una foto (nombre, documento,
-- código): la lista se pinta y se busca sin preguntarle nada a Odoo, y una
-- cotización vieja sigue diciendo lo que se cotizó aunque en Odoo renombren el
-- producto.
--
-- El canal dice de dónde vino el pedido de cotización. Por ahora solo se marca;
-- las de WhatsApp se generarán solas más adelante.

create type public.canal_cotizacion as enum ('tienda', 'whatsapp');

-- La fila se guarda ANTES de ir a Odoo, para que un Odoo caído no le haga perder
-- a nadie lo que acaba de teclear. `pendiente` dura lo que tarda la llamada;
-- `error` se queda hasta que alguien pulse "Reintentar".
create type public.sincronizacion_odoo as enum ('pendiente', 'sincronizada', 'error');

create table public.cotizaciones (
  id    uuid primary key default gen_random_uuid(),
  canal public.canal_cotizacion not null default 'tienda',

  -- El cliente en Odoo y su foto.
  odoo_partner_id   integer not null check (odoo_partner_id > 0),
  cliente_nombre    text    not null check (btrim(cliente_nombre) <> ''),
  cliente_documento text,
  cliente_telefono  text,

  -- La cotización en Odoo. Única: una sale.order no puede ser dos cotizaciones.
  odoo_order_id   integer unique check (odoo_order_id > 0),
  odoo_order_name text,

  sincronizacion       public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text,

  -- Los pone Odoo al crear la cotización: él aplica impuestos y listas de precios.
  monto_sin_impuestos numeric(12, 2) check (monto_sin_impuestos >= 0),
  monto_impuestos     numeric(12, 2),
  monto_total         numeric(12, 2) check (monto_total >= 0),

  -- Internas. No se escriben en `sale.order.note`, que son los términos y
  -- condiciones que imprime la cotización.
  notas text,

  -- Si la creó el asistente de /cotizaciones/asistente, el chat de donde salió:
  -- desde ahí se descargan el PDF y la hoja de corte.
  chat_agente_id text,

  creado_por     uuid references public.usuarios (id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint cotizaciones_sincronizada_con_orden
    check ((odoo_order_id is not null) = (sincronizacion = 'sincronizada')),
  constraint cotizaciones_error_con_motivo
    check ((sincronizacion = 'error') = (btrim(coalesce(error_sincronizacion, '')) <> ''))
);

comment on table public.cotizaciones is
  'Cotización del sistema. Cliente y productos viven en Odoo; aquí la relación y una foto.';
comment on column public.cotizaciones.odoo_order_id is
  'sale.order de Odoo. 1:1: la escribe la app al crearla allá, o el asistente.';

create index cotizaciones_creado_en_idx on public.cotizaciones (creado_en desc);
create index cotizaciones_partner_idx   on public.cotizaciones (odoo_partner_id, creado_en desc);

create trigger cotizaciones_actualizado_en
  before update on public.cotizaciones
  for each row execute function public.tocar_actualizado_en();

-- La N:N con los productos de Odoo. Una fila por línea, no por producto: la misma
-- plancha puede ir dos veces con medidas distintas.
create table public.cotizacion_productos (
  id            uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones (id) on delete cascade,
  posicion      smallint not null check (posicion >= 1),

  odoo_product_id integer not null check (odoo_product_id > 0),
  producto_nombre text    not null check (btrim(producto_nombre) <> ''),
  -- La referencia interna de Odoo (`default_code`). Es por donde más se busca.
  producto_codigo text,

  -- Medidas, acabado: lo que viaja a la descripción de la línea en Odoo.
  descripcion text,

  -- Media plancha existe: se admiten decimales.
  cantidad        numeric(12, 3) not null check (cantidad > 0),
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),

  unique (cotizacion_id, posicion)
);

create index cotizacion_productos_producto_idx on public.cotizacion_productos (odoo_product_id);

-- ── Alta en una sola transacción ────────────────────────────────────────────
-- SECURITY INVOKER, como `crear_pedido`: corre con los permisos de quien llama,
-- así que la RLS sigue exigiendo Administración y `auth.uid()` firma la fila.
--
-- Sirve para los dos caminos: el formulario (sin orden de Odoo todavía, queda
-- `pendiente`) y el asistente (que ya la creó en Odoo, y llega `sincronizada`).
-- En el segundo, si la misma orden ya estaba registrada se devuelve la existente
-- en vez de fallar: el registro desde el chat tiene que poder repetirse.

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
    descripcion, cantidad, precio_unitario
  )
  select
    nuevo_id,
    l.n::smallint,
    (l.v ->> 'odoo_product_id')::integer,
    btrim(l.v ->> 'producto_nombre'),
    nullif(btrim(l.v ->> 'producto_codigo'), ''),
    nullif(btrim(l.v ->> 'descripcion'), ''),
    (l.v ->> 'cantidad')::numeric,
    (l.v ->> 'precio_unitario')::numeric
  from jsonb_array_elements(p_lineas) with ordinality as l (v, n);

  return nuevo_id;
end $$;

-- ── Sugerencias: lo más usado, para cuando el buscador está vacío ───────────
-- `security_invoker`: las lee quien pregunta, con su RLS. Sin eso serían una
-- puerta trasera a la tabla.

create view public.clientes_cotizados
with (security_invoker = true) as
select distinct on (odoo_partner_id)
  odoo_partner_id,
  cliente_nombre,
  cliente_documento,
  cliente_telefono,
  creado_en as ultima_vez,
  (count(*) over (partition by odoo_partner_id))::integer as veces
from public.cotizaciones
order by odoo_partner_id, creado_en desc;

create view public.productos_mas_cotizados
with (security_invoker = true) as
select
  cp.odoo_product_id,
  (count(*))::integer as veces,
  max(c.creado_en)    as ultima_vez
from public.cotizacion_productos cp
join public.cotizaciones c on c.id = cp.cotizacion_id
where c.creado_en > now() - interval '90 days'
group by cp.odoo_product_id;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Hoy cotiza solo Administración, igual que el asistente.

alter table public.cotizaciones         enable row level security;
alter table public.cotizacion_productos enable row level security;

create policy cotizaciones_admin on public.cotizaciones
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy cotizacion_productos_admin on public.cotizacion_productos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

revoke all on public.cotizaciones, public.cotizacion_productos from anon, authenticated;

grant select, insert, delete on public.cotizaciones, public.cotizacion_productos to authenticated;

-- Lo que se toca después del alta es solo el resultado de ir a Odoo. Lo cotizado
-- no se edita: para eso se hace otra cotización.
grant update (
  odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
  monto_sin_impuestos, monto_impuestos, monto_total
) on public.cotizaciones to authenticated;

revoke all on public.clientes_cotizados, public.productos_mas_cotizados from anon;
grant select on public.clientes_cotizados, public.productos_mas_cotizados to authenticated;

-- Las funciones nacen ejecutables por PUBLIC: hay que quitárselo a PUBLIC y no
-- solo a `anon`, que lo hereda de ahí.
revoke execute on function public.crear_cotizacion(
  integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text,
  numeric, numeric, numeric, text
) from public, anon;
grant execute on function public.crear_cotizacion(
  integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text,
  numeric, numeric, numeric, text
) to authenticated;
