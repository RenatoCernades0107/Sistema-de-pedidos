-- Fase 2 del almacén: pasar material de un almacén a otro, y avisar cuando a un
-- pedido le falta material donde se produce o donde se despacha.
--
-- Una transferencia va en dos pasos, como el material de verdad: al enviarla
-- sale del almacén de origen y queda en tránsito; al recibirla entra al de
-- destino. En Odoo son dos operaciones, origen → Tránsito y Tránsito → destino.
--
-- Un faltante es "a este pedido le faltan N de este producto en este almacén".
-- Lo calcula el servidor al registrar el pedido (con el stock libre de Odoo) y
-- lo vuelve a revisar al recibir una transferencia. Logística y Administración
-- reciben el aviso y lo resuelven desde la pestaña "Por mover" del almacén.

-- ── 1. Lo nuevo de los enums ────────────────────────────────────────────────
-- Los valores nuevos se usan solo dentro de funciones plpgsql (se resuelven al
-- correr, no al crearlas): un enum ampliado no se puede usar en la misma
-- transacción de la migración.

alter type public.estado_sobrante add value if not exists 'en_transito';
alter type public.tipo_notificacion add value if not exists 'mover_stock';

-- ── 2. Transferencias ───────────────────────────────────────────────────────

create sequence public.transferencias_stock_numero_seq;

create table public.transferencias_stock (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('TRF-' || lpad(nextval('public.transferencias_stock_numero_seq')::text, 5, '0')),
  desde_id uuid not null references public.almacenes (id) on delete restrict,
  hacia_id uuid not null references public.almacenes (id) on delete restrict,
  check (desde_id <> hacia_id),
  -- enviada: salió del origen y está en camino. recibida: llegó. anulada: no salió.
  estado text not null default 'enviada' check (estado in ('enviada', 'recibida', 'anulada')),
  -- El pedido por el que se mueve, si lo hay (desde "Por mover").
  pedido_id uuid references public.pedidos (id) on delete set null,
  nota text,

  enviado_por uuid references public.usuarios (id) default auth.uid(),
  enviado_en timestamptz not null default now(),
  recibido_por uuid references public.usuarios (id),
  recibido_en timestamptz,

  -- Las dos operaciones de Odoo: la salida a tránsito y la entrada al destino.
  odoo_envio_id integer,
  odoo_recepcion_id integer,
  sincronizacion public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text
);

comment on table public.transferencias_stock is
  'Material que pasa de un almacén a otro: sale al enviarse (queda en tránsito) y entra al recibirse.';

create table public.transferencias_stock_lineas (
  transferencia_id uuid not null references public.transferencias_stock (id) on delete cascade,
  posicion smallint not null check (posicion > 0),
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  cantidad integer not null check (cantidad > 0 and cantidad <= 99999),
  -- Un sobrante viaja como su lote: una línea por sobrante, cantidad 1.
  sobrante_codigo text references public.sobrantes (codigo) on delete restrict on update cascade,
  check (sobrante_codigo is null or cantidad = 1),
  primary key (transferencia_id, posicion)
);

create index transferencias_stock_enviado_idx on public.transferencias_stock (enviado_en desc);
create index transferencias_stock_estado_idx on public.transferencias_stock (estado) where estado = 'enviada';
create index transferencias_stock_lineas_sobrante_idx on public.transferencias_stock_lineas (sobrante_codigo)
  where sobrante_codigo is not null;

alter table public.transferencias_stock enable row level security;
alter table public.transferencias_stock_lineas enable row level security;

-- Las ve también el taller: recibe lo que le llega. Las crea y cambia quien
-- gestiona el stock; recibir pasa por `recibir_transferencia`, que deja también
-- al taller.
create policy transferencias_stock_lectura on public.transferencias_stock
  for select to authenticated using (public.auth_rol() is not null);
create policy transferencias_stock_gestion on public.transferencias_stock
  for insert to authenticated with check (public.gestiona_stock());
create policy transferencias_stock_cambios on public.transferencias_stock
  for update to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());
create policy transferencias_stock_lineas_lectura on public.transferencias_stock_lineas
  for select to authenticated using (public.auth_rol() is not null);
create policy transferencias_stock_lineas_gestion on public.transferencias_stock_lineas
  for insert to authenticated with check (public.gestiona_stock());

revoke all on public.transferencias_stock, public.transferencias_stock_lineas from anon, authenticated;
grant select, insert, update on public.transferencias_stock to authenticated;
grant select, insert on public.transferencias_stock_lineas to authenticated;
revoke all on sequence public.transferencias_stock_numero_seq from anon;
grant usage on sequence public.transferencias_stock_numero_seq to authenticated;

-- ── 3. Faltantes ────────────────────────────────────────────────────────────

create table public.faltantes_stock (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  -- Cuánto falta (no cuánto pide el pedido): media plancha existe.
  cantidad numeric(10, 2) not null check (cantidad > 0),
  -- Dónde hace falta: donde se produce o de donde se despacha.
  almacen_id uuid not null references public.almacenes (id) on delete cascade,
  motivo text not null check (motivo in ('corte', 'terminado', 'despacho')),
  -- De dónde traerlo. `null`: no hay en ningún almacén, hay que comprar.
  origen_sugerido_id uuid references public.almacenes (id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_camino', 'resuelto', 'descartado')),
  transferencia_id uuid references public.transferencias_stock (id) on delete set null,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

comment on table public.faltantes_stock is
  'Material que le falta a un pedido en el almacén donde se produce o se despacha. Es el aviso de "mover stock".';

-- Uno vivo por pedido, producto y almacén: revisar de nuevo actualiza, no duplica.
create unique index faltantes_stock_unico on public.faltantes_stock (pedido_id, producto_odoo_id, almacen_id)
  where estado in ('pendiente', 'en_camino');
create index faltantes_stock_abiertos_idx on public.faltantes_stock (creado_en)
  where estado in ('pendiente', 'en_camino');

alter table public.faltantes_stock enable row level security;

-- Quien ve el pedido ve lo que le falta (la subconsulta respeta el RLS de
-- pedidos). Lo escribe quien gestiona el stock.
create policy faltantes_stock_lectura on public.faltantes_stock
  for select to authenticated
  using (public.gestiona_stock() or exists (select 1 from public.pedidos p where p.id = pedido_id));
create policy faltantes_stock_gestion on public.faltantes_stock
  for all to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());

revoke all on public.faltantes_stock from anon, authenticated;
grant select, insert, update, delete on public.faltantes_stock to authenticated;

-- ── 4. Recibir ──────────────────────────────────────────────────────────────
-- Recibe también el taller (lo que le llega a él). Lo de Odoo ya lo hizo el
-- servidor: esto anota la llegada y pasa los sobrantes a su almacén nuevo.

create function public.recibir_transferencia(p_id uuid, p_odoo_recepcion_id integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.transferencias_stock%rowtype;
begin
  if coalesce(public.auth_rol() not in ('administracion', 'logistica', 'operaciones'), true) then
    raise exception 'Tu rol no recibe transferencias';
  end if;
  select * into v_t from public.transferencias_stock where id = p_id for update;
  if not found then
    raise exception 'Esa transferencia no existe';
  end if;
  if v_t.estado = 'recibida' then
    return;
  end if;
  if v_t.estado <> 'enviada' then
    raise exception 'Esa transferencia está anulada';
  end if;

  update public.transferencias_stock
     set estado = 'recibida',
         recibido_por = auth.uid(),
         recibido_en = now(),
         odoo_recepcion_id = coalesce(p_odoo_recepcion_id, odoo_recepcion_id),
         sincronizacion = case when p_odoo_recepcion_id is not null then 'sincronizada' else sincronizacion end,
         error_sincronizacion = case when p_odoo_recepcion_id is not null then null else error_sincronizacion end
   where id = p_id;

  update public.sobrantes s
     set almacen_id = v_t.hacia_id,
         estado = 'disponible',
         ubicacion = null
    from public.transferencias_stock_lineas l
   where l.transferencia_id = p_id
     and l.sobrante_codigo = s.codigo
     and s.estado = 'en_transito';

  update public.faltantes_stock
     set estado = 'resuelto', resuelto_en = now()
   where transferencia_id = p_id
     and estado = 'en_camino';
end $$;

revoke execute on function public.recibir_transferencia(uuid, integer) from public, anon;
grant execute on function public.recibir_transferencia(uuid, integer) to authenticated;

-- Un sobrante sale en una transferencia: queda en tránsito y no se reserva para
-- ningún corte hasta que llegue. Solo los que están disponibles en el origen.
create function public.enviar_sobrantes(p_transferencia uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.transferencias_stock%rowtype;
  v_malos text;
begin
  if not public.gestiona_stock() then
    raise exception 'Tu rol no mueve stock';
  end if;
  select * into v_t from public.transferencias_stock where id = p_transferencia;
  if not found then
    raise exception 'Esa transferencia no existe';
  end if;

  select string_agg(l.sobrante_codigo, ', ')
    into v_malos
    from public.transferencias_stock_lineas l
    join public.sobrantes s on s.codigo = l.sobrante_codigo
   where l.transferencia_id = p_transferencia
     and (s.estado::text <> 'disponible' or s.almacen_id <> v_t.desde_id);
  if v_malos is not null then
    raise exception 'Estos sobrantes no están disponibles en el almacén de origen: %', v_malos;
  end if;

  update public.sobrantes s
     set estado = 'en_transito'
    from public.transferencias_stock_lineas l
   where l.transferencia_id = p_transferencia
     and l.sobrante_codigo = s.codigo;
end $$;

revoke execute on function public.enviar_sobrantes(uuid) from public, anon;
grant execute on function public.enviar_sobrantes(uuid) to authenticated;

-- Anular una transferencia que no llegó a salir en Odoo: sus sobrantes vuelven a
-- estar disponibles en el origen, y sus faltantes, pendientes.
create function public.anular_transferencia(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.transferencias_stock%rowtype;
begin
  if not public.gestiona_stock() then
    raise exception 'Tu rol no mueve stock';
  end if;
  select * into v_t from public.transferencias_stock where id = p_id for update;
  if not found then
    raise exception 'Esa transferencia no existe';
  end if;
  if v_t.estado <> 'enviada' then
    raise exception 'Solo se anula una transferencia que todavía no se recibe';
  end if;
  if v_t.odoo_envio_id is not null then
    raise exception 'Ya salió en Odoo: para devolverla, haz una transferencia de vuelta';
  end if;

  update public.transferencias_stock set estado = 'anulada' where id = p_id;
  update public.sobrantes s
     set estado = 'disponible'
    from public.transferencias_stock_lineas l
   where l.transferencia_id = p_id
     and l.sobrante_codigo = s.codigo
     and s.estado = 'en_transito';
  update public.faltantes_stock
     set estado = 'pendiente', transferencia_id = null
   where transferencia_id = p_id
     and estado = 'en_camino';
end $$;

revoke execute on function public.anular_transferencia(uuid) from public, anon;
grant execute on function public.anular_transferencia(uuid) to authenticated;

-- ── 5. El aviso ─────────────────────────────────────────────────────────────
-- Un aviso por persona de Administración y Logística, con lo que le falta al
-- pedido. Como `notificar_pedido`: si algo falla, se pierde el aviso, no el
-- trabajo de quien llamó.

create function public.avisar_faltantes(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text;
  v_cuantos integer;
  v_detalle text;
  v_n integer := 0;
begin
  if not public.gestiona_stock() and public.auth_rol() is null then
    raise exception 'Sin sesión';
  end if;
  select codigo into v_codigo from public.pedidos where id = p_pedido;
  if v_codigo is null then
    return 0;
  end if;

  select count(*),
         string_agg(coalesce(f.codigo, f.nombre) || ' ×' || trim_scale(f.cantidad)::text || ' en ' || a.nombre,
                    ', ' order by f.creado_en)
    into v_cuantos, v_detalle
    from public.faltantes_stock f
    join public.almacenes a on a.id = f.almacen_id
   where f.pedido_id = p_pedido
     and f.estado = 'pendiente';
  if v_cuantos = 0 then
    return 0;
  end if;

  insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, url, pedido_id)
  select u.id,
         'mover_stock'::text::public.tipo_notificacion,
         'Mover stock para ' || v_codigo,
         'Le falta material: ' || left(v_detalle, 300) || '.',
         '/almacen?vista=mover',
         p_pedido
    from public.usuarios u
   where u.activo
     and u.rol in ('administracion', 'logistica');
  get diagnostics v_n = row_count;
  return v_n;

exception when others then
  raise warning 'avisar_faltantes: no se pudo encolar el aviso del pedido %: %', p_pedido, sqlerrm;
  return 0;
end $$;

revoke execute on function public.avisar_faltantes(uuid) from public, anon;
grant execute on function public.avisar_faltantes(uuid) to authenticated;
