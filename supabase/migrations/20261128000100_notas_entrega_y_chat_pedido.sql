-- Notas de la entrega y chat del pedido.
--
--   1. `pedidos.notas_entrega`: quién entrega el pedido y cómo (en mano, con
--      movilidad, por agencia…). Reemplaza a las "notas para el taller" del alta,
--      que se pegaban al final de `detalle`; lo del taller va ahora en las
--      indicaciones de cada ítem.
--   2. `pedido_mensajes`: un chat por pedido para que el equipo hable de él sin
--      salir del sistema.

-- ── 1. Notas de la entrega ──────────────────────────────────────────────────

alter table public.pedidos
  add column notas_entrega text
    check (notas_entrega is null or (btrim(notas_entrega) <> '' and length(notas_entrega) <= 1000));

comment on column public.pedidos.notas_entrega is
  'Quién entrega el pedido y cómo. Lo ven los tres roles: el taller también despacha.';

grant select (notas_entrega) on public.pedidos to authenticated;
-- Solo Administración la corrige: el trigger `pedidos_escritura_por_rol` no la
-- deja en la lista de Logística ni de Operaciones.
grant update (notas_entrega) on public.pedidos to authenticated;

-- Las vistas de rol, copiadas de `20260901000800_comprobante_acepta_boletas.sql`
-- (su definición vigente) con `notas_entrega` en la de Operaciones, que las otras
-- dos heredan.
drop view if exists public.pedidos_admin;
drop view if exists public.pedidos_logistica;
drop view if exists public.pedidos_operaciones;

create view public.pedidos_operaciones as
select
  p.id, p.codigo, p.es_provincia, p.nombre_cliente,
  p.tipos_pedido, p.tipo_producto_terminado, p.cantidad,
  p.lugar_entrega, p.ubicacion_actual, p.estado, p.motivo,
  p.fecha_prometida, p.fecha_creacion, p.fecha_entrega, p.fecha_anulacion,
  p.detalle, p.observaciones, p.responsable_id,
  t.nombre  as responsable,
  d.nombre  as departamento,
  pr.nombre as provincia,
  (btrim(coalesce(p.numero_comprobante, '')) <> '') as tiene_comprobante,
  p.notas_entrega
from public.pedidos p
left join public.trabajadores     t  on t.id  = p.responsable_id
left join public.envios_provincia e  on e.pedido_id = p.id
left join public.departamentos    d  on d.id  = e.departamento_id
left join public.provincias       pr on pr.id = e.provincia_id
where public.auth_rol() is not null;

create view public.pedidos_logistica as
select
  o.*,
  p.telefono_cliente, p.direccion_entrega, p.creado_por,
  e.nombre_agencia, e.nombre_persona_recoge, e.tipo_documento, e.numero_documento,
  e.telefono_persona_recoge, e.monto_flete, e.flete_pagado, e.observaciones_envio,
  e.departamento_id, e.provincia_id
from public.pedidos_operaciones o
join public.pedidos p on p.id = o.id
left join public.envios_provincia e on e.pedido_id = p.id
where public.auth_rol() in ('administracion', 'logistica');

create view public.pedidos_admin as
select
  l.*,
  p.tipo_pago, p.plazo_credito_dias, p.monto_total, p.monto_pagado, p.saldo, p.pagado,
  p.numero_comprobante
from public.pedidos_logistica l
join public.pedidos p on p.id = l.id
where public.es_admin();

grant select on public.pedidos_operaciones, public.pedidos_logistica, public.pedidos_admin
  to authenticated;

-- La auditoría lleva la lista de columnas como literal: sin recrearla, los
-- cambios de `notas_entrega` no quedarían registrados.
drop trigger pedidos_auditoria on public.pedidos;

create trigger pedidos_auditoria
  after update on public.pedidos
  for each row execute function public.auditar_cambios(
    '{nombre_cliente,telefono_cliente,tipos_pedido,tipo_producto_terminado,cantidad,tipo_pago,
      plazo_credito_dias,monto_total,monto_pagado,lugar_entrega,direccion_entrega,ubicacion_actual,
      estado,motivo,fecha_prometida,detalle,observaciones,numero_comprobante,responsable_id,
      notas_entrega}'
  );

-- `crear_pedido` con las notas de la entrega. Es la de
-- `20261114000100_codigo_correlativo_y_archivos_por_item.sql` más `p_notas_entrega`.
drop function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid, jsonb
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
  p_indicaciones_lineas     jsonb                     default null,
  p_notas_entrega           text                      default null
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
    detalle, observaciones, responsable_id, creado_por, notas_entrega
  ) values (
    p_es_provincia, p_nombre_cliente, p_telefono_cliente, p_tipos_pedido,
    p_tipo_producto_terminado, p_cantidad, p_tipo_pago, p_plazo_credito_dias,
    coalesce(p_monto_total, 0),
    p_lugar_entrega, p_direccion_entrega, coalesce(p_ubicacion_actual, 'taller'),
    p_fecha_prometida, coalesce(p_detalle, ''), p_observaciones, p_responsable_id,
    auth.uid(), nullif(btrim(p_notas_entrega), '')
  )
  returning id, codigo into nuevo_id, nuevo_codigo;

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
  numeric, boolean, text, numeric, public.metodo_pago, uuid, jsonb, text
) from public, anon;
grant execute on function public.crear_pedido(
  boolean, text, public.tipo_pedido[], numeric, public.tipo_pago, public.lugar_entrega,
  date, text, public.producto_terminado, smallint, numeric, text, public.ubicacion,
  text, text, uuid, smallint, smallint, text, text, public.tipo_documento, text, text,
  numeric, boolean, text, numeric, public.metodo_pago, uuid, jsonb, text
) to authenticated;

-- ── 2. Chat del pedido ──────────────────────────────────────────────────────

create table public.pedido_mensajes (
  id           uuid        primary key default gen_random_uuid(),
  pedido_id    uuid        not null references public.pedidos (id) on delete cascade,
  autor_id     uuid        not null default auth.uid() references public.usuarios (id) on delete cascade,
  -- El nombre se copia al escribir: `usuarios` solo deja leer el perfil propio, y
  -- un chat tiene que decir quién habló aunque la cuenta se desactive después.
  autor_nombre text        not null default '',
  autor_rol    public.rol,
  texto        text        not null check (btrim(texto) <> '' and length(texto) <= 2000),
  creado_en    timestamptz not null default now()
);

create index pedido_mensajes_pedido_idx on public.pedido_mensajes (pedido_id, creado_en);

comment on table public.pedido_mensajes is
  'El chat de cada pedido. Lo leen y escriben los tres roles; nadie edita ni borra.';

-- Quién escribe lo decide la sesión, no el navegador.
create function public.firmar_mensaje_pedido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.autor_id := auth.uid();
  new.creado_en := now();
  select u.nombre, u.rol into new.autor_nombre, new.autor_rol
    from public.usuarios u
   where u.id = new.autor_id;
  new.autor_nombre := coalesce(new.autor_nombre, '');
  new.texto := btrim(new.texto);
  return new;
end $$;

revoke execute on function public.firmar_mensaje_pedido() from public, anon, authenticated;

create trigger pedido_mensajes_firmar
  before insert on public.pedido_mensajes
  for each row execute function public.firmar_mensaje_pedido();

alter table public.pedido_mensajes enable row level security;

create policy pedido_mensajes_lectura on public.pedido_mensajes
  for select to authenticated using (public.auth_rol() is not null);

create policy pedido_mensajes_escribir on public.pedido_mensajes
  for insert to authenticated
  with check (public.auth_rol() is not null and autor_id = auth.uid());

revoke all on public.pedido_mensajes from anon, authenticated;
grant select, insert on public.pedido_mensajes to authenticated;

-- Para que los mensajes lleguen al momento (Supabase Realtime). Si la
-- publicación no existe (un Postgres sin Supabase), el chat igual funciona
-- recargando.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pedido_mensajes;
  end if;
end $$;
