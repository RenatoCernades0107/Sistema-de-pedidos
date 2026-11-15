-- Lo que se comparte con el cliente fuera de la app: el PDF de su cotización y
-- la página de seguimiento de su pedido.
--
-- El cliente no tiene cuenta. El permiso es un token aleatorio en la URL: quien
-- tiene el enlace ve eso y nada más. `anon` no lee ninguna tabla; entra solo por
-- las dos funciones de abajo, `security definer`, que devuelven una foto
-- recortada a mano: sin teléfono, sin notas internas, sin quién hizo qué y, en
-- el seguimiento, sin montos.
--
-- Un uuid v4 tiene 122 bits aleatorios: no se adivina ni se recorre. Si un
-- enlace se filtra, se cambia el token (update … set token = gen_random_uuid())
-- y el enlace viejo deja de servir.

alter table public.cotizaciones
  add column token_publico uuid not null default gen_random_uuid() unique;

alter table public.pedidos
  add column token_seguimiento uuid not null default gen_random_uuid() unique;

comment on column public.cotizaciones.token_publico is
  'Permiso del enlace público al PDF (/c/<token>/pdf). Cambiarlo invalida el enlace.';
comment on column public.pedidos.token_seguimiento is
  'Permiso del enlace público de seguimiento (/seguimiento/<token>). Cambiarlo invalida el enlace.';

-- ── La cotización, para su PDF ──────────────────────────────────────────────
-- Con la misma forma que la fila que lee la app (`lib/cotizaciones-servidor.ts`),
-- para traducirla con el mismo código. Lleva precios: es la cotización que se
-- le manda al cliente. No lleva notas internas, ni el chat, ni el teléfono.

create function public.cotizacion_publica(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'canal', c.canal,
    'odoo_partner_id', c.odoo_partner_id,
    'cliente_nombre', c.cliente_nombre,
    'cliente_documento', c.cliente_documento,
    'cliente_telefono', null,
    'odoo_order_id', c.odoo_order_id,
    'odoo_order_name', c.odoo_order_name,
    'sincronizacion', c.sincronizacion,
    'error_sincronizacion', null,
    'monto_sin_impuestos', c.monto_sin_impuestos,
    'monto_impuestos', c.monto_impuestos,
    'monto_total', c.monto_total,
    'notas', null,
    'chat_agente_id', null,
    'creado_en', c.creado_en,
    'confirmada_en_odoo', c.confirmada_en_odoo,
    'error_confirmacion', null,
    'creador', null,
    'pedido', null,
    'cotizacion_productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'posicion', cp.posicion,
        'odoo_product_id', cp.odoo_product_id,
        'producto_nombre', cp.producto_nombre,
        'producto_codigo', cp.producto_codigo,
        'descripcion', cp.descripcion,
        'cantidad', cp.cantidad,
        'precio_unitario', cp.precio_unitario,
        'tipo', cp.tipo,
        'corte', cp.corte,
        'terminado', cp.terminado,
        'importe', cp.importe,
        'odoo_produccion_id', null
      ) order by cp.posicion)
      from public.cotizacion_productos cp
      where cp.cotizacion_id = c.id
    ), '[]'::jsonb)
  )
  from public.cotizaciones c
  where c.token_publico = p_token
$$;

revoke execute on function public.cotizacion_publica(uuid) from public;
grant execute on function public.cotizacion_publica(uuid) to anon, authenticated;

-- ── El pedido, para su seguimiento ──────────────────────────────────────────
-- Sin montos, sin teléfono, sin comprobante, sin responsable ni usuarios en el
-- historial. El motivo de una observación o anulación tampoco: lo escribe el
-- equipo para el equipo. Las líneas van sin precios (las mismas funciones que
-- usa el taller).

create function public.seguimiento_pedido(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'codigo', p.codigo,
    'cliente', p.nombre_cliente,
    'estado', p.estado,
    'tipos', to_jsonb(p.tipos_pedido),
    'fecha_creacion', p.fecha_creacion,
    'fecha_prometida', p.fecha_prometida,
    'fecha_entrega', p.fecha_entrega,
    'lugar_entrega', p.lugar_entrega,
    'direccion_entrega', p.direccion_entrega,
    'es_provincia', p.es_provincia,
    'departamento', d.nombre,
    'provincia', pr.nombre,
    'agencia', e.nombre_agencia,
    'detalle', p.detalle,
    'actualizado_en', p.actualizado_en,
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object('estado', h.estado, 'fecha', h.creado_en) order by h.creado_en)
      from public.historial_estados h
      where h.pedido_id = p.id
    ), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'posicion', cp.posicion,
        'tipo', cp.tipo,
        'nombre', cp.producto_nombre,
        'codigo', cp.producto_codigo,
        'descripcion', cp.descripcion,
        'cantidad', cp.cantidad,
        'corte', case when cp.corte is null then null else public.corte_sin_precios(cp.corte) end,
        'terminado', case when cp.terminado is null then null else public.terminado_sin_precios(cp.terminado) end
      ) order by cp.posicion)
      from public.cotizaciones c
      join public.cotizacion_productos cp on cp.cotizacion_id = c.id
      where c.pedido_id = p.id
    ), '[]'::jsonb)
  )
  from public.pedidos p
  left join public.envios_provincia e on e.pedido_id = p.id
  left join public.departamentos d on d.id = e.departamento_id
  left join public.provincias pr on pr.id = e.provincia_id
  where p.token_seguimiento = p_token
$$;

revoke execute on function public.seguimiento_pedido(uuid) from public;
grant execute on function public.seguimiento_pedido(uuid) to anon, authenticated;

-- ── El token, para quien comparte ───────────────────────────────────────────
-- Los pedidos se leen por vistas de rol (`pedidos_admin`, …) que no llevan el
-- token. Lo pide aparte quien coordina con el cliente: los mismos roles que ven
-- su teléfono (Administración y Logística).

create function public.token_seguimiento(p_codigo text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.token_seguimiento
  from public.pedidos p
  where p.codigo = p_codigo
    and public.auth_rol() in ('administracion', 'logistica')
$$;

revoke execute on function public.token_seguimiento(text) from public, anon;
grant execute on function public.token_seguimiento(text) to authenticated;
