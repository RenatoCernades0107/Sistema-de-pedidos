-- Una cotización se edita mientras es borrador; una vez enviada, no se toca.
--
--   borrador     → editable (cliente, líneas, notas). Todavía no salió al cliente.
--   enviada      → bloqueada: es lo que se le ofreció al cliente. Para cambiarla se
--                  crea una versión nueva (v2, v3…), que nace como borrador.
--   reemplazada  → una enviada cuya versión siguiente ya se envió. Queda de historial.
--
-- "Aprobada" no es un estado aparte: es tener pedido (`pedido_id`). Una cotización
-- con pedido tampoco se edita, sea cual sea su estado.
--
-- Cada versión es su propia cotización (y su propia `sale.order` en Odoo),
-- enlazada a la anterior por `reemplaza_a`: la v1 conserva exactamente lo que se
-- le ofreció al cliente.
--
-- Las reglas viven aquí y no solo en la app: un trigger rechaza editar lo
-- cotizado de una enviada o con pedido, venga la escritura de donde venga.

create type public.estado_cotizacion as enum ('borrador', 'enviada', 'reemplazada');

-- Las que ya existen ya salieron al cliente (o pudieron salir): nacen como
-- `enviada`, bloqueadas. Si hay que cambiar una, se hace su versión nueva.
alter table public.cotizaciones
  add column estado      public.estado_cotizacion not null default 'enviada',
  add column enviada_en  timestamptz,
  add column version     smallint not null default 1 check (version >= 1),
  add column reemplaza_a uuid references public.cotizaciones (id) on delete set null,
  -- Si lo editado todavía no llegó a la `sale.order` de Odoo: el motivo. `null`:
  -- Odoo está al día. Mientras tenga valor, no se puede marcar como enviada.
  add column error_edicion text;

update public.cotizaciones set enviada_en = creado_en;

-- Desde aquí, lo que se crea es un borrador.
alter table public.cotizaciones alter column estado set default 'borrador';

alter table public.cotizaciones
  add constraint cotizaciones_enviada_con_fecha
    check ((estado = 'borrador') = (enviada_en is null)),
  add constraint cotizaciones_no_se_reemplaza_a_si_misma
    check (reemplaza_a is null or reemplaza_a <> id);

-- De una cotización sale una sola versión nueva a la vez.
create unique index cotizaciones_reemplaza_a_idx
  on public.cotizaciones (reemplaza_a) where reemplaza_a is not null;

comment on column public.cotizaciones.estado is
  'borrador (editable) → enviada (bloqueada) → reemplazada (hay una versión más nueva enviada).';
comment on column public.cotizaciones.reemplaza_a is
  'La cotización de la que esta es versión nueva. Cada versión es su propia sale.order en Odoo.';
comment on column public.cotizaciones.error_edicion is
  'Lo editado todavía no está en la sale.order de Odoo, y por qué. null: Odoo está al día.';

-- ── Quién puede escribir qué ────────────────────────────────────────────────
-- Antes lo cotizado no se podía actualizar. Ahora sí, pero la regla de cuándo la
-- pone el trigger de abajo, no el permiso.

grant update (
  canal, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
  odoo_contacto_id, contacto_nombre, notas,
  estado, enviada_en, error_edicion
) on public.cotizaciones to authenticated;

-- ── La regla ────────────────────────────────────────────────────────────────

create function public.cotizacion_guardar_estado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Las notas son internas (no salen en la cotización): se pueden tocar siempre.
  if (new.canal, new.odoo_partner_id, new.cliente_nombre, new.cliente_documento,
      new.cliente_telefono, new.odoo_contacto_id, new.contacto_nombre)
     is distinct from
     (old.canal, old.odoo_partner_id, old.cliente_nombre, old.cliente_documento,
      old.cliente_telefono, old.odoo_contacto_id, old.contacto_nombre)
  then
    if old.estado <> 'borrador' or old.pedido_id is not null then
      raise exception 'COTIZACION_BLOQUEADA: una cotización enviada o con pedido no se edita; crea una versión nueva';
    end if;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'borrador' and new.estado = 'enviada' then
      if new.odoo_order_id is null or new.sincronizacion <> 'sincronizada' then
        raise exception 'COTIZACION_SIN_ODOO: primero tiene que estar creada en Odoo';
      end if;
      if new.error_edicion is not null then
        raise exception 'COTIZACION_DESACTUALIZADA: los últimos cambios todavía no están en Odoo';
      end if;
      new.enviada_en := coalesce(new.enviada_en, now());
    elsif old.estado = 'enviada' and new.estado = 'reemplazada' then
      null;
    else
      raise exception 'COTIZACION_ESTADO: de % no se puede pasar a %', old.estado, new.estado;
    end if;
  end if;

  return new;
end $$;

create trigger cotizaciones_guardar_estado
  before update on public.cotizaciones
  for each row execute function public.cotizacion_guardar_estado();

-- Al enviar la v2, la v1 queda de historial. Lo hace la base para que no dependa
-- de que la app se acuerde.
create function public.cotizacion_reemplazar_anterior()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'enviada' and old.estado = 'borrador' and new.reemplaza_a is not null then
    update public.cotizaciones
       set estado = 'reemplazada'
     where id = new.reemplaza_a and estado = 'enviada';
  end if;
  return null;
end $$;

create trigger cotizaciones_reemplazar_anterior
  after update of estado on public.cotizaciones
  for each row execute function public.cotizacion_reemplazar_anterior();

-- Las líneas siguen a su cotización: solo se agregan, quitan o cambian mientras
-- es borrador y sin pedido. Se miran las columnas de lo cotizado; lo que el
-- taller anota después (producción, planchas usadas, fichas reservadas) sí se
-- puede escribir en una cotización con pedido.
create function public.cotizacion_productos_guardar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cotizacion uuid := case when tg_op = 'DELETE' then old.cotizacion_id else new.cotizacion_id end;
  v_estado     public.estado_cotizacion;
  v_pedido     uuid;
begin
  select estado, pedido_id into v_estado, v_pedido
    from public.cotizaciones where id = v_cotizacion;

  -- Sin cotización: se está borrando en cascada con ella.
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_estado <> 'borrador' or v_pedido is not null then
    raise exception 'COTIZACION_BLOQUEADA: una cotización enviada o con pedido no se edita; crea una versión nueva';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger cotizacion_productos_guardar
  before insert or delete or update of
    cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo,
    descripcion, cantidad, precio_unitario, tipo, importe
  on public.cotizacion_productos
  for each row execute function public.cotizacion_productos_guardar();

-- ── Guardar los cambios de un borrador ──────────────────────────────────────
-- Una sola transacción: la cotización y todas sus líneas, o nada. INVOKER, como
-- `crear_cotizacion`: la RLS sigue mandando.
--
-- Cada línea de `p_lineas` viene entera (como en `crear_cotizacion`) o como
-- `{"conservar": <posición>}`: se queda igual que como estaba. Así un corte o un
-- producto terminado, que no se rehacen aquí, no se pierden al guardar.

create function public.actualizar_cotizacion(
  p_id                uuid,
  p_odoo_partner_id   integer,
  p_cliente_nombre    text,
  p_lineas            jsonb,
  p_canal             public.canal_cotizacion default 'tienda',
  p_cliente_documento text    default null,
  p_cliente_telefono  text    default null,
  p_notas             text    default null,
  p_odoo_contacto_id  integer default null,
  p_contacto_nombre   text    default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_estado   public.estado_cotizacion;
  v_pedido   uuid;
  v_orden    integer;
  v_previas  jsonb;
  contacto   text := nullif(btrim(p_contacto_nombre), '');
begin
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Una cotización necesita al menos un producto';
  end if;

  select estado, pedido_id, odoo_order_id into v_estado, v_pedido, v_orden
    from public.cotizaciones where id = p_id for update;
  if not found then
    raise exception 'La cotización ya no existe';
  end if;
  if v_estado <> 'borrador' or v_pedido is not null then
    raise exception 'COTIZACION_BLOQUEADA: una cotización enviada o con pedido no se edita; crea una versión nueva';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cp)), '[]'::jsonb) into v_previas
    from public.cotizacion_productos cp where cp.cotizacion_id = p_id;

  if exists (
    select 1
      from jsonb_array_elements(p_lineas) l (v)
     where l.v ? 'conservar'
       and not exists (
         select 1 from jsonb_array_elements(v_previas) o (v)
          where o.v ->> 'posicion' = l.v ->> 'conservar'
       )
  ) then
    raise exception 'Una línea que había en la cotización ya no está';
  end if;

  update public.cotizaciones
     set canal = coalesce(p_canal, 'tienda'),
         odoo_partner_id = p_odoo_partner_id,
         cliente_nombre = btrim(p_cliente_nombre),
         cliente_documento = nullif(btrim(p_cliente_documento), ''),
         cliente_telefono = nullif(btrim(p_cliente_telefono), ''),
         odoo_contacto_id = case when contacto is not null then p_odoo_contacto_id end,
         contacto_nombre = case when p_odoo_contacto_id is not null then contacto end,
         notas = nullif(btrim(p_notas), ''),
         -- Si ya está en Odoo, Odoo se queda con lo anterior hasta que la app lo actualice.
         error_edicion = case when v_orden is not null then 'Los cambios todavía no están en Odoo.' end
   where id = p_id;

  delete from public.cotizacion_productos where cotizacion_id = p_id;

  insert into public.cotizacion_productos (
    cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo,
    descripcion, cantidad, precio_unitario, tipo, corte, terminado, importe,
    diseno_version_id
  )
  select
    p_id,
    l.n::smallint,
    (s.v ->> 'odoo_product_id')::integer,
    btrim(s.v ->> 'producto_nombre'),
    nullif(btrim(s.v ->> 'producto_codigo'), ''),
    nullif(btrim(s.v ->> 'descripcion'), ''),
    (s.v ->> 'cantidad')::numeric,
    (s.v ->> 'precio_unitario')::numeric,
    coalesce(nullif(s.v ->> 'tipo', ''), 'producto')::public.tipo_linea,
    case when jsonb_typeof(s.v -> 'corte') = 'object' then s.v -> 'corte' end,
    case when jsonb_typeof(s.v -> 'terminado') = 'object' then s.v -> 'terminado' end,
    (s.v ->> 'importe')::numeric,
    nullif(s.v ->> 'diseno_version_id', '')::uuid
  from jsonb_array_elements(p_lineas) with ordinality as l (v, n)
  cross join lateral (
    select case
             when l.v ? 'conservar' then (
               select o.v from jsonb_array_elements(v_previas) o (v)
                where o.v ->> 'posicion' = l.v ->> 'conservar'
             )
             else l.v
           end as v
  ) s;
end $$;

-- ── Una versión nueva de una cotización enviada ─────────────────────────────
-- Copia lo cotizado (cliente, notas, líneas con sus cortes y fichas) a un
-- borrador nuevo. No copia nada de Odoo ni del taller: la versión nueva es una
-- cotización nueva allá. La original sigue como está hasta que la nueva se envíe.

create function public.nueva_version_cotizacion(p_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c        public.cotizaciones%rowtype;
  nuevo_id uuid;
begin
  select * into c from public.cotizaciones where id = p_id for update;
  if not found then
    raise exception 'La cotización ya no existe';
  end if;
  if c.estado <> 'enviada' then
    raise exception 'VERSION_NO_APLICA: solo una cotización enviada tiene versión nueva';
  end if;
  if c.pedido_id is not null then
    raise exception 'VERSION_CON_PEDIDO: ya tiene pedido; no se cambia lo que se aprobó';
  end if;
  if exists (select 1 from public.cotizaciones where reemplaza_a = p_id) then
    raise exception 'VERSION_EXISTE: ya hay una versión nueva en curso';
  end if;

  insert into public.cotizaciones (
    canal, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
    odoo_contacto_id, contacto_nombre, notas, almacen_despacho_id,
    version, reemplaza_a, creado_por
  ) values (
    c.canal, c.odoo_partner_id, c.cliente_nombre, c.cliente_documento, c.cliente_telefono,
    c.odoo_contacto_id, c.contacto_nombre, c.notas, c.almacen_despacho_id,
    c.version + 1, c.id, auth.uid()
  )
  returning id into nuevo_id;

  insert into public.cotizacion_productos (
    cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo,
    descripcion, cantidad, precio_unitario, tipo, corte, terminado, importe,
    diseno_version_id
  )
  select
    nuevo_id, posicion, odoo_product_id, producto_nombre, producto_codigo,
    descripcion, cantidad, precio_unitario, tipo, corte, terminado, importe,
    diseno_version_id
  from public.cotizacion_productos
  where cotizacion_id = p_id;

  return nuevo_id;
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────

revoke execute on function public.actualizar_cotizacion(
  uuid, integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text
) from public, anon;
grant execute on function public.actualizar_cotizacion(
  uuid, integer, text, jsonb, public.canal_cotizacion, text, text, text, integer, text
) to authenticated;

revoke execute on function public.nueva_version_cotizacion(uuid) from public, anon;
grant execute on function public.nueva_version_cotizacion(uuid) to authenticated;
