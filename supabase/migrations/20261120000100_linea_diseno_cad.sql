-- Una línea de cotización (y del pedido que sale de ella) puede venir de un
-- diseño CAD. Se enlaza a la VERSIÓN exacta que se cotizó, por clave foránea:
--   · el pedido corta lo que se vendió aunque el diseño cambie después;
--   · el diseño no se puede borrar mientras alguna cotización lo use
--     (`on delete restrict`; borrar el diseño arrastra sus versiones y choca aquí).

alter table public.cotizacion_productos
  add column diseno_version_id uuid
    references public.cad_diseno_versiones (id) on delete restrict
    check (diseno_version_id is null or tipo = 'terminado');

create index cotizacion_productos_diseno_version_idx
  on public.cotizacion_productos (diseno_version_id)
  where diseno_version_id is not null;

comment on column public.cotizacion_productos.diseno_version_id is
  'La versión del diseño CAD de la que sale este producto terminado. Impide borrar el diseño mientras se use.';

-- Un diseño libre solo se cotiza aprobado. Lo comprueba la base, no solo la app.
create function public.revisar_linea_diseno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.diseno_version_id is not null and exists (
    select 1 from public.cad_diseno_versiones v
    where v.id = new.diseno_version_id and v.plantilla = 'libre' and v.estado <> 'aprobado'
  ) then
    raise exception 'El diseño personalizado todavía no está aprobado: no se puede cotizar.';
  end if;
  return new;
end $$;

revoke execute on function public.revisar_linea_diseno() from public, anon, authenticated;

create trigger cotizacion_productos_diseno_aprobado
  before insert or update of diseno_version_id on public.cotizacion_productos
  for each row execute function public.revisar_linea_diseno();

-- ── crear_cotizacion: lee `diseno_version_id` de cada línea ─────────────────
-- Misma firma que en 20261113000400; solo cambia el insert de las líneas.

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

-- ── lineas_de_pedido: el diseño de cada línea, ya resuelto ──────────────────
-- Cambia lo que devuelve: hay que borrarla y crearla (como en 20261114000100).

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
  produccion_cerrada     boolean,
  terminado              jsonb,
  materiales_usados      jsonb,
  indicaciones           text,
  diseno_version_id      uuid,
  diseno_id              uuid,
  diseno_version         integer
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
    cp.odoo_produccion_id, cp.odoo_produccion_nombre, cp.produccion_cerrada,
    case
      when cp.terminado is null then null
      when public.es_admin() then cp.terminado
      else public.terminado_sin_precios(cp.terminado)
    end,
    cp.materiales_usados,
    cp.indicaciones,
    cp.diseno_version_id,
    v.diseno_id,
    v.version
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  join public.cotizacion_productos cp on cp.cotizacion_id = c.id
  left join public.cad_diseno_versiones v on v.id = cp.diseno_version_id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
  order by cp.posicion
$$;

revoke execute on function public.lineas_de_pedido(text) from public, anon;
grant execute on function public.lineas_de_pedido(text) to authenticated;
