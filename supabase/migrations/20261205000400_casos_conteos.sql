-- Fase 3 del almacén: bajas, conteo físico y los casos que Administración cierra.
--
-- Nada de esto cambia el stock por sí solo. Logística **reporta** una baja (una
-- plancha rota, un sobrante perdido) o **envía** un conteo, y cada diferencia
-- queda como un **caso** pendiente. Administración lo investiga y lo cierra con
-- una razón obligatoria: aplicándolo (recién entonces cambia Odoo: un scrap o un
-- ajuste) o descartándolo (apareció, se contó mal).
--
-- El conteo es ciego: lo esperado no se guarda mientras se cuenta. Al enviarlo,
-- el servidor lee el stock de Odoo y deja lo esperado en cada caso.

alter type public.tipo_notificacion add value if not exists 'caso_stock';

-- ── 1. Conteos ──────────────────────────────────────────────────────────────

create sequence public.conteos_stock_numero_seq;

create table public.conteos_stock (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('CNT-' || lpad(nextval('public.conteos_stock_numero_seq')::text, 5, '0')),
  almacen_id uuid not null references public.almacenes (id) on delete restrict,
  -- Lo que se cuenta, en palabras: "Planchas · Acrílico ECO · 3 mm".
  alcance text not null check (btrim(alcance) <> ''),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviado', 'anulado')),
  -- Cuántas diferencias salieron y cuántas coincidieron (al enviar).
  diferencias integer,
  coincidencias integer,
  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  enviado_por uuid references public.usuarios (id),
  enviado_en timestamptz
);

create table public.conteos_stock_lineas (
  conteo_id uuid not null references public.conteos_stock (id) on delete cascade,
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  -- El grupo en pantalla: "Acrílico ECO · 3 mm" o la categoría del accesorio.
  grupo text,
  -- `null`: todavía no se contó.
  contado integer check (contado is null or (contado >= 0 and contado <= 99999)),
  primary key (conteo_id, producto_odoo_id)
);

create table public.conteos_stock_sobrantes (
  conteo_id uuid not null references public.conteos_stock (id) on delete cascade,
  sobrante_codigo text not null references public.sobrantes (codigo) on delete cascade on update cascade,
  -- `null`: sin marcar.
  encontrado boolean,
  primary key (conteo_id, sobrante_codigo)
);

create index conteos_stock_creado_idx on public.conteos_stock (creado_en desc);

alter table public.conteos_stock enable row level security;
alter table public.conteos_stock_lineas enable row level security;
alter table public.conteos_stock_sobrantes enable row level security;

-- Los ven y escriben quienes gestionan el stock. Un conteo enviado (o anulado)
-- ya no se toca: ni él ni sus líneas.
create function public.conteo_abierto(p_conteo uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.conteos_stock where id = p_conteo and estado = 'borrador')
$$;
revoke execute on function public.conteo_abierto(uuid) from public, anon;
grant execute on function public.conteo_abierto(uuid) to authenticated;

create policy conteos_stock_lectura on public.conteos_stock
  for select to authenticated using (public.gestiona_stock());
create policy conteos_stock_alta on public.conteos_stock
  for insert to authenticated with check (public.gestiona_stock() and estado = 'borrador');
create policy conteos_stock_cambios on public.conteos_stock
  for update to authenticated
  using (public.gestiona_stock() and estado = 'borrador')
  with check (public.gestiona_stock());

create policy conteos_stock_lineas_lectura on public.conteos_stock_lineas
  for select to authenticated using (public.gestiona_stock());
create policy conteos_stock_lineas_escritura on public.conteos_stock_lineas
  for all to authenticated
  using (public.gestiona_stock() and public.conteo_abierto(conteo_id))
  with check (public.gestiona_stock() and public.conteo_abierto(conteo_id));

create policy conteos_stock_sobrantes_lectura on public.conteos_stock_sobrantes
  for select to authenticated using (public.gestiona_stock());
create policy conteos_stock_sobrantes_escritura on public.conteos_stock_sobrantes
  for all to authenticated
  using (public.gestiona_stock() and public.conteo_abierto(conteo_id))
  with check (public.gestiona_stock() and public.conteo_abierto(conteo_id));

revoke all on public.conteos_stock, public.conteos_stock_lineas, public.conteos_stock_sobrantes from anon, authenticated;
grant select, insert, update on public.conteos_stock to authenticated;
grant select, insert, update, delete on public.conteos_stock_lineas, public.conteos_stock_sobrantes to authenticated;
revoke all on sequence public.conteos_stock_numero_seq from anon;
grant usage on sequence public.conteos_stock_numero_seq to authenticated;

-- ── 2. Casos ────────────────────────────────────────────────────────────────

create sequence public.casos_stock_numero_seq;

create table public.casos_stock (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('CAS-' || lpad(nextval('public.casos_stock_numero_seq')::text, 5, '0')),
  -- baja: alguien reportó algo roto o perdido. diferencia: un conteo no coincidió.
  tipo text not null check (tipo in ('baja', 'diferencia')),
  almacen_id uuid not null references public.almacenes (id) on delete restrict,
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo_producto text,
  nombre text not null,
  -- Un sobrante es su lote: una baja o un "no está" de un sobrante.
  sobrante_codigo text references public.sobrantes (codigo) on delete restrict on update cascade,
  -- El cambio de stock que se propone: negativo si falta o se da de baja, positivo si sobra.
  cantidad numeric(10, 2) not null check (cantidad <> 0),
  check (tipo = 'diferencia' or cantidad < 0),
  motivo text check (motivo in ('rotura', 'defecto', 'merma', 'perdido', 'otro')),
  check ((tipo = 'baja') = (motivo is not null)),
  descripcion text,
  conteo_id uuid references public.conteos_stock (id) on delete restrict,
  esperado numeric(10, 2),
  contado numeric(10, 2),
  check (tipo = 'baja' or conteo_id is not null),

  estado text not null default 'pendiente' check (estado in ('pendiente', 'aplicado', 'descartado')),
  razon_cierre text,
  check (estado = 'pendiente' or char_length(btrim(coalesce(razon_cierre, ''))) >= 5),
  cerrado_por uuid references public.usuarios (id),
  cerrado_en timestamptz,

  reportado_por uuid references public.usuarios (id) default auth.uid(),
  reportado_en timestamptz not null default now(),

  -- El scrap o el ajuste en Odoo, al aplicarlo.
  odoo_ref integer,
  sincronizacion public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text
);

comment on table public.casos_stock is
  'Bajas reportadas y diferencias de conteo. Cambian el stock solo cuando Administración las cierra aplicándolas.';

create index casos_stock_pendientes_idx on public.casos_stock (reportado_en) where estado = 'pendiente';
create index casos_stock_reportado_idx on public.casos_stock (reportado_en desc);
-- Un sobrante no se reporta dos veces mientras su caso sigue abierto.
create unique index casos_stock_sobrante_abierto on public.casos_stock (sobrante_codigo)
  where estado = 'pendiente' and sobrante_codigo is not null;

alter table public.casos_stock enable row level security;

-- Los ven y reportan quienes gestionan el stock; se reportan siempre pendientes.
-- Lo único que se cambia después es el error de Odoo (al aplicar). Cerrar pasa
-- por `cerrar_caso`, que exige Administración y la razón.
create policy casos_stock_lectura on public.casos_stock
  for select to authenticated using (public.gestiona_stock());
create policy casos_stock_alta on public.casos_stock
  for insert to authenticated
  with check (public.gestiona_stock() and estado = 'pendiente' and razon_cierre is null and odoo_ref is null);
create policy casos_stock_error on public.casos_stock
  for update to authenticated
  using (public.es_admin() and estado = 'pendiente')
  with check (public.es_admin() and estado = 'pendiente');

revoke all on public.casos_stock from anon, authenticated;
grant select, insert on public.casos_stock to authenticated;
grant update (sincronizacion, error_sincronizacion) on public.casos_stock to authenticated;
revoke all on sequence public.casos_stock_numero_seq from anon;
grant usage on sequence public.casos_stock_numero_seq to authenticated;

-- ── 3. Cerrar un caso ───────────────────────────────────────────────────────
-- Lo de Odoo (si se aplica) ya lo hizo el servidor: aquí queda quién, cuándo y
-- por qué, y el sobrante sigue lo decidido.

create function public.cerrar_caso(p_id uuid, p_decision text, p_razon text, p_odoo_ref integer default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.casos_stock%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo Administración cierra un caso';
  end if;
  if p_decision not in ('aplicar', 'descartar') then
    raise exception 'La decisión es aplicar o descartar';
  end if;
  if char_length(btrim(coalesce(p_razon, ''))) < 5 then
    raise exception 'Escribe la razón (al menos 5 letras)';
  end if;
  select * into v_c from public.casos_stock where id = p_id for update;
  if not found then
    raise exception 'Ese caso no existe';
  end if;
  if v_c.estado <> 'pendiente' then
    raise exception 'Ese caso ya está cerrado';
  end if;

  update public.casos_stock
     set estado = case when p_decision = 'aplicar' then 'aplicado' else 'descartado' end,
         razon_cierre = btrim(p_razon),
         cerrado_por = auth.uid(),
         cerrado_en = now(),
         odoo_ref = case when p_decision = 'aplicar' then p_odoo_ref else null end,
         sincronizacion = case when p_decision = 'aplicar' then 'sincronizada' else sincronizacion end,
         error_sincronizacion = null
   where id = p_id;

  -- Un sobrante dado de baja (o que no estaba) sale del almacén.
  if p_decision = 'aplicar' and v_c.sobrante_codigo is not null and v_c.cantidad < 0 then
    update public.sobrantes
       set estado = 'baja', reserva_pedido_id = null, reserva_posicion = null
     where codigo = v_c.sobrante_codigo;
  end if;
end $$;

revoke execute on function public.cerrar_caso(uuid, text, text, integer) from public, anon;
grant execute on function public.cerrar_caso(uuid, text, text, integer) to authenticated;

-- ── 4. Enviar un conteo ─────────────────────────────────────────────────────
-- El servidor ya creó los casos (con lo esperado de Odoo): esto cierra el conteo.

create function public.enviar_conteo(p_id uuid, p_diferencias integer, p_coincidencias integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.gestiona_stock() then
    raise exception 'Tu rol no cuenta stock';
  end if;
  update public.conteos_stock
     set estado = 'enviado', enviado_por = auth.uid(), enviado_en = now(),
         diferencias = p_diferencias, coincidencias = p_coincidencias
   where id = p_id and estado = 'borrador';
  if not found then
    raise exception 'Ese conteo ya no está en borrador';
  end if;
end $$;

revoke execute on function public.enviar_conteo(uuid, integer, integer) from public, anon;
grant execute on function public.enviar_conteo(uuid, integer, integer) to authenticated;

-- ── 5. El aviso a Administración ────────────────────────────────────────────

create function public.avisar_casos(p_codigos text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_detalle text;
  v_cuantos integer;
  v_n integer := 0;
begin
  if not public.gestiona_stock() then
    raise exception 'Tu rol no reporta casos';
  end if;
  select count(*),
         string_agg(c.codigo || ' ' || coalesce(c.codigo_producto, c.nombre) || ' ' ||
                    case when c.cantidad > 0 then '+' else '' end || trim_scale(c.cantidad)::text ||
                    ' en ' || a.nombre, ', ' order by c.codigo)
    into v_cuantos, v_detalle
    from public.casos_stock c
    join public.almacenes a on a.id = c.almacen_id
   where c.codigo = any (p_codigos) and c.estado = 'pendiente';
  if v_cuantos = 0 then
    return 0;
  end if;

  insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, url)
  select u.id,
         'caso_stock'::text::public.tipo_notificacion,
         case when v_cuantos = 1 then 'Un caso de stock por revisar' else v_cuantos || ' casos de stock por revisar' end,
         left(v_detalle, 300) || '.',
         '/almacen?vista=casos'
    from public.usuarios u
   where u.activo and u.rol = 'administracion';
  get diagnostics v_n = row_count;
  return v_n;

exception when others then
  raise warning 'avisar_casos: no se pudo encolar el aviso: %', sqlerrm;
  return 0;
end $$;

revoke execute on function public.avisar_casos(text[]) from public, anon;
grant execute on function public.avisar_casos(text[]) to authenticated;
