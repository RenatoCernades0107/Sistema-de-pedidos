-- Fase 4: lo que le faltaba al esquema para poder escribir desde la app.
--
-- Dos cosas, y las dos salieron de intentar escribir de verdad:
--
--   1. `tiene_factura` en las vistas de rol. El CHECK `pedidos_numero_factura_check`
--      exige el número para pasar a `entregado`, pero ni Logística ni Operaciones
--      pueden escribir esa columna (no está en sus `permitidas` del trigger de rol)
--      ni leerla (no está en sus vistas). Sin saber si el pedido ya tiene factura,
--      el taller solo puede enterarse chocando contra un 23514. La vista expone el
--      booleano, nunca el número.
--
--   2. `crear_pedido()`. Registrar un pedido a provincia con abono son tres INSERT
--      en tres tablas; por PostgREST son tres viajes sin transacción común, y uno a
--      medias deja un pedido a provincia sin fila de envío. Aquí van juntos.

-- ── 1. Las vistas, con `tiene_factura` ───────────────────────────────────────
-- `pedidos_logistica` sale de `o.*` y `pedidos_admin` de `l.*`, así que basta con
-- añadirlo abajo del todo y recrear la cadena. Son las mismas de
-- 20260830001100_rls.sql; lo nuevo es la última columna de `pedidos_operaciones`
-- y los dos ids de ubigeo en `pedidos_logistica`.

drop view if exists public.pedidos_admin;
drop view if exists public.pedidos_logistica;
drop view if exists public.pedidos_operaciones;

create view public.pedidos_operaciones as
select
  p.id, p.codigo, p.es_provincia, p.tipos_pedido, p.tipo_producto_terminado, p.cantidad,
  p.lugar_entrega, p.ubicacion_actual, p.estado, p.motivo,
  p.fecha_prometida, p.fecha_creacion, p.fecha_entrega, p.fecha_anulacion,
  p.detalle, p.observaciones, p.responsable_id,
  t.nombre  as responsable,
  d.nombre  as departamento,
  pr.nombre as provincia,
  -- El taller necesita saber si puede entregar, no cuánto se facturó.
  (btrim(coalesce(p.numero_factura, '')) <> '') as tiene_factura
from public.pedidos p
left join public.trabajadores     t  on t.id  = p.responsable_id
left join public.envios_provincia e  on e.pedido_id = p.id
left join public.departamentos    d  on d.id  = e.departamento_id
left join public.provincias       pr on pr.id = e.provincia_id
where public.auth_rol() is not null;

create view public.pedidos_logistica as
select
  o.*,
  p.nombre_cliente, p.telefono_cliente, p.direccion_entrega, p.creado_por,
  e.nombre_agencia, e.nombre_persona_recoge, e.tipo_documento, e.numero_documento,
  e.telefono_persona_recoge, e.monto_flete, e.flete_pagado, e.observaciones_envio,
  -- Para escribir el envío hace falta el id, no el nombre del departamento.
  e.departamento_id, e.provincia_id
from public.pedidos_operaciones o
join public.pedidos p on p.id = o.id
left join public.envios_provincia e on e.pedido_id = p.id
where public.auth_rol() in ('administracion', 'logistica');

create view public.pedidos_admin as
select
  l.*,
  p.tipo_pago, p.plazo_credito_dias, p.monto_total, p.monto_pagado, p.saldo, p.pagado,
  p.numero_factura
from public.pedidos_logistica l
join public.pedidos p on p.id = l.id
where public.es_admin();

grant select on public.pedidos_operaciones, public.pedidos_logistica, public.pedidos_admin
  to authenticated;

-- ── 2. Alta del pedido en una sola transacción ───────────────────────────────
-- SECURITY INVOKER (el default, y a propósito): la función corre con los permisos
-- de quien la llama, así que la política `pedidos_crear` sigue exigiendo
-- Administración y `auth.uid()` sigue firmando el historial y la auditoría. Con
-- SECURITY DEFINER esto sería un agujero: cualquiera con la clave publicable
-- registraría pedidos.
--
-- El código NO se pasa: lo pone `pedidos_asignar_codigo` y se devuelve para que la
-- app pueda navegar al pedido recién creado.

create function public.crear_pedido(
  p_es_provincia            boolean,
  p_nombre_cliente          text,
  p_tipos_pedido            public.tipo_pedido[],
  p_cantidad                numeric,
  p_tipo_pago               public.tipo_pago,
  p_lugar_entrega           public.lugar_entrega,
  p_fecha_prometida         date,
  p_telefono_cliente        text                      default null,
  p_tipo_producto_terminado public.producto_terminado default null,
  p_plazo_credito_dias      smallint                  default null,
  p_monto_total             numeric                   default 0,
  p_direccion_entrega       text                      default null,
  p_ubicacion_actual        public.ubicacion          default 'taller',
  p_detalle                 text                      default '',
  p_observaciones           text                      default null,
  p_responsable_id          uuid                      default null,
  p_departamento_id         smallint                  default null,
  p_provincia_id            smallint                  default null,
  p_nombre_agencia          text                      default null,
  p_nombre_persona_recoge   text                      default null,
  p_tipo_documento          public.tipo_documento     default 'DNI',
  p_numero_documento        text                      default null,
  p_telefono_persona_recoge text                      default null,
  p_monto_flete             numeric                   default 0,
  p_flete_pagado            boolean                   default false,
  p_observaciones_envio     text                      default null,
  p_abono_inicial           numeric                   default 0,
  p_metodo_pago             public.metodo_pago        default 'efectivo'
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  nuevo_id     uuid;
  nuevo_codigo text;
begin
  insert into public.pedidos (
    es_provincia, nombre_cliente, telefono_cliente, tipos_pedido,
    tipo_producto_terminado, cantidad, tipo_pago, plazo_credito_dias, monto_total,
    lugar_entrega, direccion_entrega, ubicacion_actual, fecha_prometida,
    detalle, observaciones, responsable_id, creado_por
  ) values (
    p_es_provincia, p_nombre_cliente, p_telefono_cliente, p_tipos_pedido,
    p_tipo_producto_terminado, p_cantidad, p_tipo_pago, p_plazo_credito_dias,
    coalesce(p_monto_total, 0),
    p_lugar_entrega, p_direccion_entrega, coalesce(p_ubicacion_actual, 'taller'),
    p_fecha_prometida, coalesce(p_detalle, ''), p_observaciones, p_responsable_id,
    auth.uid()
  )
  returning id, codigo into nuevo_id, nuevo_codigo;

  if p_es_provincia then
    if p_departamento_id is null then
      raise exception 'Un pedido a provincia necesita su departamento';
    end if;

    insert into public.envios_provincia (
      pedido_id, departamento_id, provincia_id, nombre_agencia,
      nombre_persona_recoge, tipo_documento, numero_documento,
      telefono_persona_recoge, monto_flete, flete_pagado, observaciones_envio
    ) values (
      nuevo_id, p_departamento_id, p_provincia_id, p_nombre_agencia,
      p_nombre_persona_recoge, coalesce(p_tipo_documento, 'DNI'), p_numero_documento,
      p_telefono_persona_recoge, coalesce(p_monto_flete, 0),
      coalesce(p_flete_pagado, false), p_observaciones_envio
    );
  end if;

  -- Al contado se cobra el total en el acto; a cuenta, lo adelantado; al crédito no
  -- entra nada todavía. Cuánto es lo decide la app: aquí solo se registra el abono,
  -- y el trigger de `pagos` recalcula el saldo.
  if coalesce(p_abono_inicial, 0) > 0 then
    insert into public.pagos (pedido_id, monto, metodo, registrado_por)
    values (nuevo_id, p_abono_inicial, coalesce(p_metodo_pago, 'efectivo'), auth.uid());
  end if;

  return nuevo_codigo;
end $$;

grant execute on function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago
) to authenticated;
