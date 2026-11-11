-- Pedidos con líneas: cliente y productos de Odoo, y cortes calculados.
--
-- A partir de aquí un pedido se arma como una cotización. Detrás de cada pedido
-- nuevo hay una cotización (`cotizaciones.pedido_id`, 1:1) que guarda el cliente
-- de Odoo y las líneas —productos y cortes— y que es la `sale.order` de Odoo. El
-- pedido conserva lo suyo: entrega, pago, estado, responsable.
--
-- Esta migración hace cuatro cosas:
--   1. `crear_pedido` ya no exige que la cotización esté en Odoo: el pedido se
--      registra aunque Odoo esté caído, y se sincroniza después.
--   2. Las planchas realmente usadas en cada corte, y si el stock ya se descontó.
--   3. Las líneas del pedido para el taller, sin precios.
--   4. Anotar las planchas usadas y el descuento de stock desde cualquier rol.

-- ── 1. crear_pedido ─────────────────────────────────────────────────────────
-- La misma firma de `20261106000100_pedido_desde_cotizacion.sql`; solo cambia la
-- condición del vínculo.

create or replace function public.crear_pedido(
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
  -- ninguno. `pedido_id is null` es lo que impide sacar dos pedidos de la misma
  -- cotización, aunque dos personas pulsen a la vez.
  if p_cotizacion_id is not null then
    update public.cotizaciones
       set pedido_id = nuevo_id
     where id = p_cotizacion_id
       and pedido_id is null;

    if not found then
      raise exception 'Esa cotización ya tiene un pedido';
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

  if coalesce(p_abono_inicial, 0) > 0 then
    insert into public.pagos (pedido_id, monto, metodo, registrado_por)
    values (nuevo_id, p_abono_inicial, coalesce(p_metodo_pago, 'efectivo'), auth.uid());
  end if;

  return nuevo_codigo;
end $$;

-- ── 2. Lo que pasa después de cotizar ───────────────────────────────────────

alter table public.cotizacion_productos
  -- Las planchas que de verdad consumió el corte. NULL: todavía nadie lo dijo, y
  -- vale lo calculado (`cantidad`). Es lo que se descuenta en Odoo al terminar.
  add column planchas_usadas numeric(8, 2) check (planchas_usadas >= 0);

alter table public.cotizaciones
  -- Si la entrega ya se validó en Odoo: el stock real bajó.
  add column stock_descontado boolean not null default false,
  -- Por qué no se pudo descontar, hasta que alguien reintente.
  add column error_stock text;

grant update (planchas_usadas) on public.cotizacion_productos to authenticated;
grant update (stock_descontado, error_stock) on public.cotizaciones to authenticated;

-- ── 3. Las líneas del pedido, para quien lo trabaja ─────────────────────────
-- `cotizaciones` y sus líneas son de Administración (su RLS lo dice), pero el
-- taller necesita saber qué cortar. Estas funciones son la ventanilla: corren
-- como dueñas de las tablas (SECURITY DEFINER), solo responden a alguien con rol
-- —los mismos que ya ven el pedido— y a quien no es Administración le quitan
-- todo lo que sea dinero.

-- El cálculo de un corte con los montos en cero. En cero y no fuera: así quien lo
-- lee no necesita saber que le faltan campos.
create function public.corte_sin_precios(c jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
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
  )
$$;

create function public.lineas_de_pedido(p_codigo text)
returns table (
  posicion        smallint,
  tipo            public.tipo_linea,
  odoo_product_id integer,
  producto_nombre text,
  producto_codigo text,
  descripcion     text,
  cantidad        numeric,
  planchas_usadas numeric,
  corte           jsonb,
  precio_unitario numeric,
  importe         numeric
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
    case when public.es_admin() then cp.importe end
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  join public.cotizacion_productos cp on cp.cotizacion_id = c.id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
  order by cp.posicion
$$;

-- Cómo va el pedido en Odoo: la orden de venta y si su stock ya se descontó.
create function public.odoo_de_pedido(p_codigo text)
returns table (
  cotizacion_id      uuid,
  odoo_order_id      integer,
  odoo_order_name    text,
  sincronizacion     public.sincronizacion_odoo,
  confirmada_en_odoo boolean,
  stock_descontado   boolean,
  error_stock        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.odoo_order_id, c.odoo_order_name, c.sincronizacion,
         c.confirmada_en_odoo, c.stock_descontado, c.error_stock
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
$$;

-- ── 4. Escribir desde cualquier rol ─────────────────────────────────────────

-- Cuántas planchas se usaron de verdad en un corte. Lo puede anotar quien
-- trabaja el pedido mientras el stock no se haya descontado: después, corregirlo
-- es un movimiento de inventario, y eso ya no es una anotación.
create function public.anotar_planchas_usadas(p_codigo text, p_posicion smallint, p_planchas numeric)
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
    raise exception 'Tu sesión no puede anotar planchas';
  end if;
  if p_planchas is null or p_planchas < 0 or p_planchas > 9999 then
    raise exception 'La cantidad de planchas usadas no es válida';
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
     set planchas_usadas = p_planchas
   where cotizacion_id = v_cotizacion
     and posicion = p_posicion
     and tipo = 'corte';

  if not found then
    raise exception 'Esa línea no es un corte de este pedido';
  end if;
end $$;

-- El resultado de ir a Odoo a descontar el stock. Lo escribe la app después de
-- validar la entrega, con la sesión de quien movió el pedido a Listo —que puede
-- ser el taller, y el taller no escribe en `cotizaciones`—.
create function public.anotar_stock_de_pedido(p_codigo text, p_descontado boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede anotar el stock';
  end if;

  update public.cotizaciones c
     set stock_descontado = c.stock_descontado or coalesce(p_descontado, false),
         error_stock = case when coalesce(p_descontado, false) then null else nullif(btrim(p_error), '') end
    from public.pedidos p
   where c.pedido_id = p.id
     and p.codigo = p_codigo;
end $$;

-- Las funciones nacen ejecutables por PUBLIC: hay que quitárselo a PUBLIC y no
-- solo a `anon`, que lo hereda de ahí.
revoke execute on function public.corte_sin_precios(jsonb) from public, anon;
revoke execute on function public.lineas_de_pedido(text) from public, anon;
revoke execute on function public.odoo_de_pedido(text) from public, anon;
revoke execute on function public.anotar_planchas_usadas(text, smallint, numeric) from public, anon;
revoke execute on function public.anotar_stock_de_pedido(text, boolean, text) from public, anon;

grant execute on function public.corte_sin_precios(jsonb) to authenticated;
grant execute on function public.lineas_de_pedido(text) to authenticated;
grant execute on function public.odoo_de_pedido(text) to authenticated;
grant execute on function public.anotar_planchas_usadas(text, smallint, numeric) to authenticated;
grant execute on function public.anotar_stock_de_pedido(text, boolean, text) to authenticated;
