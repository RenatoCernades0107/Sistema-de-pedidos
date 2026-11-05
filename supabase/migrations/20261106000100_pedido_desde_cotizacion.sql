-- Un pedido a partir de una cotización.
--
-- Cuando el cliente acepta, la cotización pasa a producción: se registra el
-- pedido con lo cotizado ya llenado, se elige si va para el taller o para la
-- tienda (`ubicacion_actual`), y la `sale.order` se confirma en Odoo.
--
--   cotizaciones  1:1  pedidos   (pedido_id, único: una cotización, un pedido)
--
-- El vínculo vive en `cotizaciones` y no en `pedidos` a propósito: `pedidos`
-- reparte columnas por rol en sus vistas, su auditoría y su trigger de escritura,
-- y una cotización solo la ve Administración. Así nada de eso cambia.

alter table public.cotizaciones
  add column pedido_id uuid unique references public.pedidos (id) on delete set null,
  -- Si la `sale.order` ya se confirmó en Odoo (pasó de cotización a orden de venta).
  add column confirmada_en_odoo boolean not null default false,
  -- Por qué no se pudo confirmar. Se queda hasta que alguien pulse "Confirmar en Odoo".
  add column error_confirmacion text;

comment on column public.cotizaciones.pedido_id is
  'El pedido que salió de esta cotización. Lo escribe `crear_pedido`, en la misma transacción del alta.';

-- La confirmación es resultado de ir a Odoo, como la sincronización: la anota la
-- app después del alta. `pedido_id` lo escribe `crear_pedido`, que es INVOKER.
grant update (pedido_id, confirmada_en_odoo, error_confirmacion)
  on public.cotizaciones to authenticated;

-- ── crear_pedido con cotización ─────────────────────────────────────────────
-- La misma función de `20260901000100_factura_visible_y_alta_atomica.sql`, con un
-- último argumento opcional. Cambiar la firma obliga a soltar la anterior: con
-- `create or replace` quedarían las dos y la llamada por nombre sería ambigua.

drop function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago
);

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
  p_metodo_pago             public.metodo_pago        default 'efectivo',
  p_cotizacion_id           uuid                      default null
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

  -- El vínculo va en la misma transacción que el alta: o quedan los dos, o
  -- ninguno. La condición `pedido_id is null` es la que impide sacar dos pedidos
  -- de la misma cotización, aunque dos personas pulsen a la vez; la de
  -- `sincronizada`, la que exige que exista en Odoo para poder confirmarla.
  if p_cotizacion_id is not null then
    update public.cotizaciones
       set pedido_id = nuevo_id
     where id = p_cotizacion_id
       and pedido_id is null
       and sincronizacion = 'sincronizada';

    if not found then
      raise exception 'Esa cotización ya tiene un pedido o todavía no está en Odoo';
    end if;
  end if;

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

-- Las funciones nacen ejecutables por PUBLIC: hay que quitárselo a PUBLIC y no
-- solo a `anon`, que lo hereda de ahí.
revoke execute on function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid
) from public, anon;
grant execute on function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid
) to authenticated;
