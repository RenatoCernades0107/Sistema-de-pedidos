-- Un pedido más simple: código correlativo, indicaciones por ítem, archivos por ítem.
--
--   1. El código pasa de `LCL_2026_H4TP` (destino + tipo + año + azar) a
--      `P2611-001`: P de pedido, 26 el año, 11 el mes, 001 el correlativo del mes.
--      Caben 999 pedidos al mes. Los pedidos que ya existen conservan su código.
--   2. Cada línea del pedido (producto, corte, producto terminado) puede llevar
--      sus propias indicaciones para el taller.
--   3. Cada archivo de diseño puede colgar de una línea o ser del pedido entero.

-- ── 1. El código ────────────────────────────────────────────────────────────

-- Un contador por mes. Solo lo toca `generar_codigo_pedido`, que corre como
-- dueña de la tabla: nadie más tiene por qué leerlo ni escribirlo.
create table public.pedido_contadores (
  periodo text     primary key check (periodo ~ '^[0-9]{4}$'),
  ultimo  smallint not null check (ultimo between 1 and 999)
);

alter table public.pedido_contadores enable row level security;
revoke all on public.pedido_contadores from anon, authenticated;

comment on table public.pedido_contadores is
  'El último correlativo de pedido de cada mes (AAMM). Lo mueve `generar_codigo_pedido`.';

drop trigger pedidos_asignar_codigo on public.pedidos;
drop function public.asignar_codigo_pedido();
drop function public.generar_codigo_pedido(boolean, public.tipo_pedido[], integer);
drop function public.sigla_de(public.tipo_pedido[]);
drop function public.sufijo_codigo();

-- El mes es el de Lima: un pedido de las 9 de la noche del 30 no es de diciembre.
--
-- El INSERT ... ON CONFLICT toma el bloqueo de la fila del mes, así que dos altas
-- a la vez se turnan en vez de repetir número; y si el alta del pedido se revierte,
-- el contador se revierte con ella (no quedan huecos por fallos).
create function public.generar_codigo_pedido(p_fecha timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_periodo text := to_char(p_fecha at time zone 'America/Lima', 'YYMM');
  v_numero  integer;
begin
  insert into public.pedido_contadores as c (periodo, ultimo)
  values (v_periodo, 1)
  on conflict (periodo) do update set ultimo = c.ultimo + 1 where c.ultimo < 999
  returning c.ultimo into v_numero;

  -- La condición del UPDATE no se cumple al llegar a 999: no devuelve fila.
  if v_numero is null then
    raise exception 'Ya hay 999 pedidos registrados este mes (%): no caben más con este formato de código', v_periodo;
  end if;

  return 'P' || v_periodo || '-' || lpad(v_numero::text, 3, '0');
end $$;

revoke execute on function public.generar_codigo_pedido(timestamptz) from public, anon, authenticated;

-- SECURITY DEFINER porque `crear_pedido` corre con los permisos de quien llama, y
-- quien llama no puede ejecutar `generar_codigo_pedido` (ni debe: gastaría números).
create function public.asignar_codigo_pedido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.codigo is null then
    new.codigo := public.generar_codigo_pedido(coalesce(new.fecha_creacion, now()));
  end if;

  return new;
end $$;

revoke execute on function public.asignar_codigo_pedido() from public, anon, authenticated;

create trigger pedidos_asignar_codigo
  before insert on public.pedidos
  for each row execute function public.asignar_codigo_pedido();

-- Los pedidos de antes siguen con su código (ya está en boletas y en chats).
alter table public.pedidos drop constraint pedidos_codigo_formato;
alter table public.pedidos add constraint pedidos_codigo_formato
  check (
    codigo ~ '^P[0-9]{4}-[0-9]{3}$'
    or codigo ~ '^[LP](CL|CM|SP|PT|AC|MX)_[0-9]{4}_[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'
  );

comment on column public.pedidos.codigo is
  'P{AA}{MM}-{NNN} (P2611-001). Los anteriores a la migración 20261114000100 tienen el formato viejo LCL_2026_H4TP. Lo genera el trigger del INSERT y después es inmutable.';

-- `es_provincia` ya no abre el código, pero sigue siendo inmutable: define el
-- lugar de entrega.
create or replace function public.pedido_campos_inmutables()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'El código del pedido es inmutable (% → %)', old.codigo, new.codigo;
  end if;

  if new.es_provincia is distinct from old.es_provincia then
    raise exception 'El destino local/provincia del pedido % es inmutable', old.codigo;
  end if;

  if new.fecha_creacion is distinct from old.fecha_creacion then
    raise exception 'La fecha de creación del pedido % es inmutable', old.codigo;
  end if;

  return new;
end $$;

-- ── 2. Indicaciones por ítem ────────────────────────────────────────────────

alter table public.cotizacion_productos
  add column indicaciones text
    check (indicaciones is null or (btrim(indicaciones) <> '' and length(indicaciones) <= 500));

comment on column public.cotizacion_productos.indicaciones is
  'Lo que el taller tiene que saber de esta línea (acabados, pegado…). Solo del taller: no viaja a Odoo.';

-- Las escribe `crear_pedido` en la transacción del alta, con la sesión de
-- Administración (la RLS de `cotizacion_productos` ya exige eso).
grant update (indicaciones) on public.cotizacion_productos to authenticated;

drop function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid
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
  p_cotizacion_id           uuid                      default null,
  -- [{ "posicion": 2, "texto": "bordes pulidos" }]: las indicaciones de cada línea.
  p_indicaciones_lineas     jsonb                     default null
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

    if p_indicaciones_lineas is not null then
      if jsonb_typeof(p_indicaciones_lineas) <> 'array' then
        raise exception 'Las indicaciones por línea no son válidas';
      end if;

      update public.cotizacion_productos cp
         set indicaciones = nullif(btrim(i.texto), '')
        from (
          select (e ->> 'posicion')::smallint as posicion, e ->> 'texto' as texto
            from jsonb_array_elements(p_indicaciones_lineas) as e
        ) i
       where cp.cotizacion_id = p_cotizacion_id
         and cp.posicion = i.posicion;
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

revoke execute on function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid, jsonb
) from public, anon;
grant execute on function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid, jsonb
) to authenticated;

-- lineas_de_pedido: también las indicaciones. Cambia lo que devuelve, y eso no lo
-- permite `create or replace`.
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
  indicaciones           text
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
    cp.indicaciones
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  join public.cotizacion_productos cp on cp.cotizacion_id = c.id
  where p.codigo = p_codigo
    and public.auth_rol() is not null
  order by cp.posicion
$$;

revoke execute on function public.lineas_de_pedido(text) from public, anon;
grant execute on function public.lineas_de_pedido(text) to authenticated;

-- ── 3. Archivos por ítem ────────────────────────────────────────────────────

-- La posición de la línea del pedido a la que pertenece el archivo. NULL: es del
-- pedido entero. Sin FK porque la línea cuelga de la cotización del pedido; quien
-- la comprueba es `registrarAdjunto`.
alter table public.adjuntos
  add column linea_posicion smallint
    check (linea_posicion is null or (linea_posicion >= 1 and tipo = 'diseno'));

comment on column public.adjuntos.linea_posicion is
  'La línea del pedido (cotizacion_productos.posicion) a la que se refiere el diseño. NULL: es del pedido entero. Solo los diseños se ligan a una línea.';
