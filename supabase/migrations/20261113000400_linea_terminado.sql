-- Las líneas de producto terminado.
--
-- Una línea de una cotización (y de su pedido) ya podía ser un producto de Odoo
-- o un corte. Ahora también un producto terminado: algo que el taller fabrica,
-- estándar (del catálogo `pt_productos`) o personalizado (llenado a mano).
--
-- Como el corte, lleva su ficha congelada en un JSON (`lib/terminados/guardado.ts`):
-- qué producto es, medidas, material, opciones, el material que se estimó y el
-- precio que sugirió la fórmula junto al que se cobró. En sus columnas:
--   odoo_product_id   el producto de Odoo con el que se vende (uno por producto
--                     del catálogo; uno genérico para los personalizados)
--   cantidad          cuántas unidades
--   precio_unitario   el precio final de cada una
--   importe           cantidad × precio
--
-- El material se descuenta al terminar, con lo que de verdad se usó
-- (`materiales_usados`), no con lo estimado. Reservar lo estimado al confirmar
-- es opcional y lo dice la ficha.

alter table public.cotizacion_productos
  add column terminado jsonb,
  -- Lo que logística dice que se usó: [{ productoId, codigo, nombre, unidad, cantidad }].
  -- `null`: nadie lo dijo todavía.
  add column materiales_usados jsonb,
  add constraint cotizacion_productos_terminado_con_ficha
    check ((tipo = 'terminado') = (terminado is not null and jsonb_typeof(terminado) = 'object')),
  add constraint cotizacion_productos_terminado_con_importe
    check (tipo <> 'terminado' or importe is not null),
  add constraint cotizacion_productos_materiales_usados_lista
    check (materiales_usados is null or (tipo = 'terminado' and jsonb_typeof(materiales_usados) = 'array'));

comment on column public.cotizacion_productos.terminado is
  'La ficha del producto terminado tal como se cotizó (lib/terminados/guardado.ts). Solo en las líneas de tipo terminado.';

-- ── crear_cotizacion: las líneas pueden traer su ficha ──────────────────────
-- Misma firma: solo cambia lo que lee de cada línea del JSON.

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
    descripcion, cantidad, precio_unitario, tipo, corte, terminado, importe
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
    (l.v ->> 'importe')::numeric
  from jsonb_array_elements(p_lineas) with ordinality as l (v, n);

  return nuevo_id;
end $$;

-- ── La ficha, para quien no ve dinero ───────────────────────────────────────
-- Como `corte_sin_precios`: los montos en cero y no fuera, para que quien la lee
-- no tenga que saber que le faltan campos.

create function public.terminado_sin_precios(t jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select t
    || '{"precioSugerido": 0, "precioUnitario": 0, "costoMaterial": 0, "factor": 1}'::jsonb
    || jsonb_build_object(
      'opciones',
      coalesce(
        (select jsonb_agg(o || '{"extra": 0}'::jsonb order by n)
           from jsonb_array_elements(t -> 'opciones') with ordinality as x (o, n)),
        '[]'::jsonb
      ),
      'materiales',
      coalesce(
        (select jsonb_agg(m || '{"precio": 0}'::jsonb order by n)
           from jsonb_array_elements(t -> 'materiales') with ordinality as x (m, n)),
        '[]'::jsonb
      )
    )
$$;

-- ── lineas_de_pedido: también la ficha y lo usado ───────────────────────────
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
  produccion_cerrada     boolean,
  terminado              jsonb,
  materiales_usados      jsonb
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
    cp.materiales_usados
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  join public.cotizacion_productos cp on cp.cotizacion_id = c.id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
  order by cp.posicion
$$;

-- ── Anotar lo que de verdad se usó ──────────────────────────────────────────
-- Como `anotar_planchas_usadas`: lo dice quien termina el pedido, que no escribe
-- en las líneas. Se puede corregir hasta que el stock se descuenta.

create function public.anotar_materiales_de_terminado(p_codigo text, p_posicion smallint, p_materiales jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cotizacion uuid;
  v_descontado boolean;
  v_estado     public.estado_pedido;
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede anotar materiales';
  end if;
  if jsonb_typeof(p_materiales) is distinct from 'array' or jsonb_array_length(p_materiales) > 60 then
    raise exception 'La lista de materiales usados no es válida';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_materiales) m
     where jsonb_typeof(m) <> 'object'
        or jsonb_typeof(m -> 'productoId') is distinct from 'number'
        or jsonb_typeof(m -> 'cantidad') is distinct from 'number'
        or (m ->> 'productoId')::numeric <= 0
        or (m ->> 'cantidad')::numeric < 0
        or (m ->> 'cantidad')::numeric > 99999
  ) then
    raise exception 'Uno de los materiales usados no es válido';
  end if;

  select c.id, c.stock_descontado, p.estado
    into v_cotizacion, v_descontado, v_estado
    from public.pedidos p
    join public.cotizaciones c on c.pedido_id = p.id
   where p.codigo = p_codigo;

  if v_cotizacion is null then
    raise exception 'Ese pedido no tiene productos terminados';
  end if;
  if v_descontado then
    raise exception 'El stock de este pedido ya se descontó en Odoo';
  end if;
  if v_estado in ('entregado', 'anulado') then
    raise exception 'El pedido ya está cerrado';
  end if;

  update public.cotizacion_productos
     set materiales_usados = p_materiales
   where cotizacion_id = v_cotizacion
     and posicion = p_posicion
     and tipo = 'terminado';

  if not found then
    raise exception 'Esa línea no es un producto terminado de este pedido';
  end if;
end $$;

-- ── anotar_produccion: también la orden de un producto terminado ────────────

create or replace function public.anotar_produccion(
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
     and cp.tipo in ('corte', 'terminado');

  if not found then
    raise exception 'Esa línea no se fabrica en esa cotización';
  end if;
end $$;

-- ── Los más cotizados: sin los productos terminados ─────────────────────────
-- El buscador de productos sugiere lo que más se cotiza. El producto de Odoo de
-- un terminado (CAJ-001) no es algo que se agregue suelto: se arma en su editor.

create or replace view public.productos_mas_cotizados
with (security_invoker = true) as
select
  cp.odoo_product_id,
  (count(*))::integer as veces,
  max(c.creado_en)    as ultima_vez
from public.cotizacion_productos cp
join public.cotizaciones c on c.id = cp.cotizacion_id
where c.creado_en > now() - interval '90 days'
  and cp.tipo <> 'terminado'
group by cp.odoo_product_id;

revoke execute on function public.terminado_sin_precios(jsonb) from public, anon;
revoke execute on function public.lineas_de_pedido(text) from public, anon;
revoke execute on function public.anotar_materiales_de_terminado(text, smallint, jsonb) from public, anon;

grant execute on function public.terminado_sin_precios(jsonb) to authenticated;
grant execute on function public.lineas_de_pedido(text) to authenticated;
grant execute on function public.anotar_materiales_de_terminado(text, smallint, jsonb) to authenticated;
