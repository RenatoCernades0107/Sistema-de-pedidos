-- Permisos del rol `ventas` (ver `20261212000100_rol_ventas.sql`).
--
-- Qué hace Ventas:
--   · Cotiza y registra pedidos. Ve solo SUS cotizaciones; Administración ve todas.
--   · Lee el catálogo y los precios que usa el cotizador (solo lectura).
--   · Lee el almacén y el stock (la política de lectura ya cubre a todo rol).
--   · Ve los pedidos completos como Administración: cliente, envío, montos,
--     comprobante, facturas y pagos. Sin auditoría.
--   · No cambia estados, ubicación ni responsable de un pedido (el trigger
--     `pedidos_escritura_por_rol` ya deja a todo rol desconocido sin columnas).
--   · Lee los pagos, pero solo registra el abono inicial del pedido que crea.

create function public.es_ventas()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_rol() = 'ventas', false)
$$;

revoke execute on function public.es_ventas() from public, anon;
grant execute on function public.es_ventas() to authenticated;

-- ── Cotizaciones: las propias ───────────────────────────────────────────────

create policy cotizaciones_ventas on public.cotizaciones
  for all to authenticated
  using (public.es_ventas() and creado_por = auth.uid())
  with check (public.es_ventas() and creado_por = auth.uid());

create policy cotizacion_productos_ventas on public.cotizacion_productos
  for all to authenticated
  using (
    public.es_ventas()
    and exists (
      select 1 from public.cotizaciones c
       where c.id = cotizacion_id and c.creado_por = auth.uid()
    )
  )
  with check (
    public.es_ventas()
    and exists (
      select 1 from public.cotizaciones c
       where c.id = cotizacion_id and c.creado_por = auth.uid()
    )
  );

-- ── Catálogo y precios del cotizador: solo lectura ──────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'configuracion', 'grupos_plancha', 'formatos_plancha',
    'pt_tipos', 'pt_productos', 'pt_medidas', 'pt_espesores', 'pt_colores', 'pt_producto_color',
    'pt_opciones', 'pt_producto_opcion', 'pt_materiales', 'pt_producto_material',
    'pt_segmentos', 'pt_producto_segmento'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.es_ventas())',
      t || '_ventas_lectura', t
    );
  end loop;
end $$;

-- ── Pedidos ─────────────────────────────────────────────────────────────────

drop policy pedidos_crear on public.pedidos;
create policy pedidos_crear on public.pedidos
  for insert to authenticated
  with check (public.auth_rol() in ('administracion', 'ventas'));

-- Un pedido a provincia lleva su envío, que se escribe en la misma transacción.
create policy envios_alta_ventas on public.envios_provincia
  for insert to authenticated with check (public.es_ventas());

-- El abono inicial (al contado o a cuenta) entra con el alta. Ventas no lo lee ni
-- lo cambia después: solo lo inserta, y solo en un pedido que registró ella o él.
create policy pagos_alta_ventas on public.pagos
  for insert to authenticated
  with check (
    public.es_ventas()
    and registrado_por = auth.uid()
    and exists (
      select 1 from public.pedidos p
       where p.id = pedido_id and p.creado_por = auth.uid()
    )
  );

-- Los pedidos que lee Ventas: lo de Administración (cliente, envío, dinero y
-- comprobante). La auditoría es otra vista y sigue siendo solo de Administración.
create view public.pedidos_ventas as
select
  o.*,
  p.telefono_cliente, p.direccion_entrega, p.creado_por,
  e.nombre_agencia, e.nombre_persona_recoge, e.tipo_documento, e.numero_documento,
  e.telefono_persona_recoge, e.monto_flete, e.flete_pagado, e.observaciones_envio,
  e.departamento_id, e.provincia_id,
  p.tipo_pago, p.plazo_credito_dias, p.monto_total, p.monto_pagado, p.saldo, p.pagado,
  p.numero_comprobante
from public.pedidos_operaciones o
join public.pedidos p on p.id = o.id
left join public.envios_provincia e on e.pedido_id = p.id
where public.es_ventas();

grant select on public.pedidos_ventas to authenticated;

-- Los abonos de cada pedido: Administración y Ventas.
create or replace view public.pagos_pedido as
select
  p.id,
  p.pedido_id,
  p.monto,
  p.metodo,
  p.fecha,
  u.nombre as usuario
from public.pagos p
left join public.usuarios u on u.id = p.registrado_por
where public.auth_rol() in ('administracion', 'ventas');

-- Las líneas de un pedido traen sus precios e importes a quien ve el dinero.
-- `lineas_de_pedido` y `lineas_de_pedidos` comparan con `es_admin()`: se
-- reescriben desde su definición vigente, con `ve_precios()` en su lugar.
create function public.ve_precios()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_rol() in ('administracion', 'ventas'), false)
$$;

revoke execute on function public.ve_precios() from public, anon;
grant execute on function public.ve_precios() to authenticated;

do $$
declare
  f record;
begin
  for f in
    select pg_get_functiondef(p.oid) as def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('lineas_de_pedido', 'lineas_de_pedidos')
       and p.prosrc like '%public.es_admin()%'
  loop
    execute replace(f.def, 'public.es_admin()', 'public.ve_precios()');
  end loop;
end $$;

-- ── Ventanillas que hoy son de Administración y Logística ───────────────────
-- Las mismas funciones, con el rol de Ventas en la lista.

create or replace function public.token_seguimiento(p_codigo text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.token_seguimiento
  from public.pedidos p
  where p.codigo = p_codigo
    and public.auth_rol() in ('administracion', 'logistica', 'ventas')
$$;

create or replace function public.cliente_de_pedido(p_codigo text)
returns table (documento text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.cliente_documento
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  where p.codigo = p_codigo
    and public.auth_rol() in ('administracion', 'logistica', 'ventas')
$$;

create or replace function public.config_lista_precios()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select valor from public.configuracion where clave = 'lista_precios'),
    '{}'::jsonb
  )
  where public.auth_rol() in ('administracion', 'logistica', 'ventas')
$$;
