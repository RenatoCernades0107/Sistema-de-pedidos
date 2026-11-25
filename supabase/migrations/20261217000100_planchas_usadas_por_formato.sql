-- Un corte puede mezclar formatos de plancha (p. ej. 3 de 122×244 y 1 de
-- 122×183): cada plancha nueva del JSON del corte dice su formato en
-- `origen.formato`, y el corte lleva todos en `formatos`. Lo que el taller anota
-- como usado va entonces por formato: `{ "<código>": planchas }`.
-- `planchas_usadas` sigue siendo el total (la suma).

-- ── 1. La columna ────────────────────────────────────────────────────────────

alter table public.cotizacion_productos
  add column planchas_usadas_formato jsonb
    check (planchas_usadas_formato is null or jsonb_typeof(planchas_usadas_formato) = 'object');

comment on column public.cotizacion_productos.planchas_usadas_formato is
  'Si el corte mezcla formatos: las planchas usadas de cada uno, por código de Odoo. planchas_usadas es la suma.';

-- ── 2. Anotarlas ─────────────────────────────────────────────────────────────
-- Cambia la firma (un parámetro más): hay que borrarla y crearla.

drop function public.anotar_planchas_usadas(text, smallint, numeric);

create function public.anotar_planchas_usadas(
  p_codigo text,
  p_posicion smallint,
  p_planchas numeric,
  p_por_formato jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cotizacion uuid;
  v_descontado boolean;
  v_estado     public.estado_pedido;
  v_valor      jsonb;
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede anotar planchas';
  end if;
  if p_planchas is null or p_planchas < 0 or p_planchas > 9999 then
    raise exception 'La cantidad de planchas usadas no es válida';
  end if;
  if p_por_formato is not null then
    if jsonb_typeof(p_por_formato) <> 'object' then
      raise exception 'Las planchas por formato no son válidas';
    end if;
    for v_valor in select value from jsonb_each(p_por_formato) loop
      if jsonb_typeof(v_valor) <> 'number' or (v_valor #>> '{}')::numeric < 0 or (v_valor #>> '{}')::numeric > 9999 then
        raise exception 'La cantidad de planchas usadas de un formato no es válida';
      end if;
    end loop;
  end if;

  select c.id, c.stock_descontado, p.estado
    into v_cotizacion, v_descontado, v_estado
    from public.pedidos p
    join public.cotizaciones c on c.pedido_id = p.id
   where p.codigo = p_codigo;

  if v_cotizacion is null then
    raise exception 'Ese pedido no tiene cortes';
  end if;
  if v_descontado then
    raise exception 'El stock de este pedido ya se descontó en Odoo';
  end if;
  if v_estado in ('entregado', 'anulado') then
    raise exception 'El pedido ya está cerrado';
  end if;

  update public.cotizacion_productos
     set planchas_usadas = p_planchas,
         planchas_usadas_formato = p_por_formato
   where cotizacion_id = v_cotizacion
     and posicion = p_posicion
     and tipo = 'corte';

  if not found then
    raise exception 'Esa línea no es un corte de este pedido';
  end if;
end $$;

revoke execute on function public.anotar_planchas_usadas(text, smallint, numeric, jsonb) from public, anon;
grant execute on function public.anotar_planchas_usadas(text, smallint, numeric, jsonb) to authenticated;

-- ── 3. Sin precios para quien no es Administración: también los de cada formato ──

create or replace function public.corte_sin_precios(c jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(x.s -> 'formatos') = 'array' then jsonb_set(
      x.s,
      '{formatos}',
      coalesce(
        (select jsonb_agg(jsonb_set(f, '{precio}', '0'::jsonb) order by n)
           from jsonb_array_elements(x.s -> 'formatos') with ordinality as t (f, n)),
        '[]'::jsonb
      )
    )
    else x.s
  end
  from (
    select jsonb_set(
      jsonb_set(
        c || '{"montoMaterial": 0, "montoServicio": 0, "total": 0, "desglose": []}'::jsonb,
        '{formato,precio}', '0'::jsonb
      ),
      '{planchas}',
      coalesce(
        (select jsonb_agg(jsonb_set(p, '{cobro,monto}', '0'::jsonb) order by n)
           from jsonb_array_elements(c -> 'planchas') with ordinality as t (p, n)),
        '[]'::jsonb
      )
    ) as s
  ) x
$$;

-- ── 4. lineas_de_pedido: devuelve lo anotado por formato ─────────────────────
-- Cambia lo que devuelve: hay que borrarla y crearla (como en 20261120000100).

drop function public.lineas_de_pedido(text);

create function public.lineas_de_pedido(p_codigo text)
returns table (
  posicion                smallint,
  tipo                    public.tipo_linea,
  odoo_product_id         integer,
  producto_nombre         text,
  producto_codigo         text,
  descripcion             text,
  cantidad                numeric,
  planchas_usadas         numeric,
  corte                   jsonb,
  precio_unitario         numeric,
  importe                 numeric,
  odoo_produccion_id      integer,
  odoo_produccion_nombre  text,
  produccion_cerrada      boolean,
  terminado               jsonb,
  materiales_usados       jsonb,
  indicaciones            text,
  diseno_version_id       uuid,
  diseno_id               uuid,
  diseno_version          integer,
  planchas_usadas_formato jsonb
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
    v.version,
    cp.planchas_usadas_formato
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
