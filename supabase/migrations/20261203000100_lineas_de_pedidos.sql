-- Las líneas de varios pedidos de una vez, para la lista de pedidos.
--
-- `lineas_de_pedido(codigo)` sirve al detalle: un pedido, todas sus columnas. La
-- lista necesita saber qué lleva cada tarjeta —productos, cortes, terminados—
-- y pedirlas una por una sería una consulta por tarjeta. Esta es la misma
-- ventanilla para un lote: las mismas reglas (solo quien tiene rol, y sin
-- precios para quien no es Administración) y las mismas columnas, más el pedido
-- al que pertenece cada línea.

create function public.lineas_de_pedidos(p_ids uuid[])
returns table (
  pedido_id              uuid,
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
    p.id,
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
  where p.id = any (p_ids)
    and public.auth_rol() is not null
  order by p.id, cp.posicion
$$;

-- Las funciones nacen ejecutables por PUBLIC: hay que quitárselo a PUBLIC y no
-- solo a `anon`, que lo hereda de ahí.
revoke execute on function public.lineas_de_pedidos(uuid[]) from public, anon;
grant execute on function public.lineas_de_pedidos(uuid[]) to authenticated;
