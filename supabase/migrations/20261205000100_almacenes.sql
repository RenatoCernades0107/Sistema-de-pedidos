-- Almacenes: el stock deja de vivir en "el almacén" y pasa a estar en uno de varios.
--
-- La empresa tiene tres: Andahuaylas (la tienda), Católica (el taller) y
-- Esmeraldas (depósito), y puede abrir más. Cada uno es un `stock.warehouse` de
-- Odoo que la app crea; el almacén que Odoo traía de fábrica queda como
-- "anterior": no se usa para nada nuevo.
--
-- Esta migración:
--   1. La tabla `almacenes` y quién la escribe (Administración y Logística).
--   2. Cada sobrante en un almacén, con su precio si Administración lo fijó.
--   3. El fin del código compartido entre colores, y el piloto de sobrantes
--      encendido para todos los materiales.
--   4. Las categorías de accesorios (propias de la app) y qué accesorio va en cuál.
--   5. Los ingresos de stock: compras y ajustes, con sus líneas.
--   6. El almacén del que sale cada venta.
--   7. La configuración del almacén (el factor del precio de un sobrante).

-- ── 1. Almacenes ────────────────────────────────────────────────────────────

-- Quién gestiona el stock: ingresa, crea productos y almacenes.
create function public.gestiona_stock()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_rol() in ('administracion', 'logistica'), false)
$$;

revoke execute on function public.gestiona_stock() from public, anon;
grant execute on function public.gestiona_stock() to authenticated;

create table public.almacenes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (btrim(nombre) <> ''),
  -- El código corto del almacén en Odoo (`stock.warehouse.code`): hasta 5 letras.
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{1,5}$'),
  -- El taller corta láser y fabrica los productos terminados; la tienda hace
  -- algunos cortes manuales. Un depósito solo guarda.
  tipo text not null default 'deposito' check (tipo in ('taller', 'tienda', 'deposito')),

  odoo_warehouse_id integer unique,
  -- La ubicación de stock del almacén (`lot_stock_id`): donde entran y salen las cosas.
  odoo_ubicacion_id integer,
  sincronizacion public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text,

  activo boolean not null default true,
  orden smallint not null default 0,
  creado_en timestamptz not null default now()
);

comment on table public.almacenes is
  'Los almacenes de la empresa. Cada uno es un stock.warehouse de Odoo que la app crea.';

-- Un solo taller y una sola tienda: son los que deciden de dónde sale el material.
create unique index almacenes_un_taller on public.almacenes (tipo) where tipo in ('taller', 'tienda');

insert into public.almacenes (nombre, codigo, tipo, orden) values
  ('Andahuaylas', 'AND', 'tienda', 1),
  ('Católica', 'CAT', 'taller', 2),
  ('Esmeraldas', 'ESM', 'deposito', 3);

alter table public.almacenes enable row level security;

create policy almacenes_lectura on public.almacenes
  for select to authenticated using (public.auth_rol() is not null);
create policy almacenes_alta on public.almacenes
  for insert to authenticated with check (public.gestiona_stock());
create policy almacenes_cambios on public.almacenes
  for update to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());

revoke all on public.almacenes from anon, authenticated;
grant select, insert, update on public.almacenes to authenticated;

-- ── 2. Sobrantes por almacén ────────────────────────────────────────────────
-- Todavía no hay sobrantes guardados: el almacén puede ser obligatorio desde ya.
-- Si los hubiera (una base de pruebas), van al taller, que es donde se corta.

alter table public.sobrantes
  add column almacen_id uuid references public.almacenes (id) on delete restrict,
  -- Lo que Administración fijó. Vacío: el costo de su pedazo de plancha por el
  -- factor de la configuración.
  add column precio_venta numeric(10, 2) check (precio_venta is null or precio_venta >= 0);

update public.sobrantes set almacen_id = (select id from public.almacenes where tipo = 'taller')
 where almacen_id is null;

alter table public.sobrantes alter column almacen_id set not null;

create index sobrantes_almacen_idx on public.sobrantes (almacen_id, grupo_id, estado);

-- Un sobrante también puede quedar de un producto terminado.
alter table public.sobrantes drop constraint sobrantes_origen_check;
alter table public.sobrantes
  add constraint sobrantes_origen_check check (origen in ('manual', 'corte', 'terminado', 'odoo'));

-- Cada color tiene su código: el sobrante ya no necesita decir el suyo.
alter table public.sobrantes drop column color;

-- El precio lo fija solo Administración. El resto escribe el sobrante (el taller
-- lo registra al terminar un pedido) pero no esa columna.
revoke update on public.sobrantes from authenticated;
grant update (ubicacion, almacen_id, estado, estandar, pedido_id, linea_posicion, reserva_pedido_id,
              reserva_posicion, odoo_lot_id, sincronizacion, error_sincronizacion, grupo_id,
              largo_cm, ancho_cm, origen, codigo)
  on public.sobrantes to authenticated;

create function public.fijar_precio_sobrante(p_codigo text, p_precio numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo Administración cambia el precio de venta';
  end if;
  if p_precio is not null and p_precio < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;
  update public.sobrantes set precio_venta = p_precio where codigo = p_codigo;
  if not found then
    raise exception 'Ese sobrante no existe';
  end if;
end $$;

revoke execute on function public.fijar_precio_sobrante(text, numeric) from public, anon;
grant execute on function public.fijar_precio_sobrante(text, numeric) to authenticated;

-- ── 3. Un código por color, y sobrantes para todos ──────────────────────────
-- El código que se compartía entre colores queda para el color que el catálogo
-- ya decía (F7E029 → Negro); los otros colores se crean como productos nuevos.

alter table public.formatos_plancha drop column sku_compartido;

update public.grupos_plancha set sobrantes_activo = true where not sobrantes_activo;
alter table public.grupos_plancha alter column sobrantes_activo set default true;

-- Crear planchas es de quien gestiona el stock, no solo de Administración.
create policy grupos_plancha_stock_alta on public.grupos_plancha
  for insert to authenticated with check (public.gestiona_stock());
create policy formatos_plancha_stock_alta on public.formatos_plancha
  for insert to authenticated with check (public.gestiona_stock());

-- ── 4. Accesorios ───────────────────────────────────────────────────────────
-- Los accesorios ya existen en Odoo con su código. La categoría es de la app: en
-- Odoo no está. Nombre, precio y unidad se leen de Odoo por el código.

create table public.categorias_accesorio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (btrim(nombre) <> ''),
  -- Con qué empieza el código de un accesorio nuevo de esta categoría (ACC, PEG):
  -- la app sigue el correlativo que tenga Odoo con ese prefijo.
  prefijo text not null check (prefijo ~ '^[A-Z]{2,5}$'),
  orden smallint not null default 0
);

create table public.accesorios (
  id uuid primary key default gen_random_uuid(),
  codigo_odoo text not null unique check (btrim(codigo_odoo) <> ''),
  categoria_id uuid not null references public.categorias_accesorio (id) on delete restrict,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index accesorios_categoria_idx on public.accesorios (categoria_id);

alter table public.categorias_accesorio enable row level security;
alter table public.accesorios enable row level security;

create policy categorias_accesorio_lectura on public.categorias_accesorio
  for select to authenticated using (public.auth_rol() is not null);
create policy categorias_accesorio_escritura on public.categorias_accesorio
  for all to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());
create policy accesorios_lectura on public.accesorios
  for select to authenticated using (public.auth_rol() is not null);
create policy accesorios_escritura on public.accesorios
  for all to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());

revoke all on public.categorias_accesorio, public.accesorios from anon, authenticated;
grant select, insert, update, delete on public.categorias_accesorio, public.accesorios to authenticated;

-- ── 5. Ingresos de stock ────────────────────────────────────────────────────
-- Una compra (llegó mercadería del proveedor, con su costo) o un ajuste (se contó
-- y se pone lo que hay). Se guardan aquí antes de ir a Odoo: si Odoo falla, lo
-- escrito no se pierde y se reintenta. Son también el principio del kárdex.

create sequence public.ingresos_stock_numero_seq;

create table public.ingresos_stock (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('ING-' || lpad(nextval('public.ingresos_stock_numero_seq')::text, 5, '0')),
  tipo text not null check (tipo in ('compra', 'ajuste')),
  almacen_id uuid not null references public.almacenes (id) on delete restrict,

  proveedor_odoo_id integer check (proveedor_odoo_id is null or proveedor_odoo_id > 0),
  proveedor_nombre text,
  -- La guía o la factura del proveedor.
  documento text check (documento is null or btrim(documento) <> ''),
  nota text,
  check (tipo = 'ajuste' or proveedor_odoo_id is not null),

  -- La recepción en Odoo (compra). Un ajuste no tiene documento propio en Odoo.
  odoo_picking_id integer,
  sincronizacion public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text,

  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now()
);

create table public.ingresos_stock_lineas (
  ingreso_id uuid not null references public.ingresos_stock (id) on delete cascade,
  posicion smallint not null check (posicion > 0),
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  -- Siempre en unidades enteras. En un ajuste es lo que se contó (puede ser 0).
  cantidad integer not null check (cantidad >= 0 and cantidad <= 99999),
  -- El costo de una unidad, en una compra.
  costo_unitario numeric(12, 4) check (costo_unitario is null or costo_unitario >= 0),
  -- En un ajuste: lo que Odoo decía antes de ponerlo.
  cantidad_anterior numeric(12, 4),
  primary key (ingreso_id, posicion)
);

create index ingresos_stock_creado_idx on public.ingresos_stock (creado_en desc);

alter table public.ingresos_stock enable row level security;
alter table public.ingresos_stock_lineas enable row level security;

create policy ingresos_stock_gestion on public.ingresos_stock
  for all to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());
create policy ingresos_stock_lineas_gestion on public.ingresos_stock_lineas
  for all to authenticated using (public.gestiona_stock()) with check (public.gestiona_stock());

revoke all on public.ingresos_stock, public.ingresos_stock_lineas from anon, authenticated;
grant select, insert, update on public.ingresos_stock, public.ingresos_stock_lineas to authenticated;
revoke all on sequence public.ingresos_stock_numero_seq from anon;
grant usage on sequence public.ingresos_stock_numero_seq to authenticated;

-- ── 6. De qué almacén sale la venta ─────────────────────────────────────────
-- El `warehouse_id` de la venta en Odoo. Sin él, Odoo usaría el almacén anterior.

alter table public.cotizaciones
  add column almacen_despacho_id uuid references public.almacenes (id) on delete set null;

-- Las columnas de `cotizaciones` se conceden una por una: sin esto, el UPDATE
-- que anota la venta en Odoo falla entero. Quién puede escribir la fila lo sigue
-- diciendo su RLS (Administración).
grant update (almacen_despacho_id) on public.cotizaciones to authenticated;

-- ── 7. Configuración del almacén ────────────────────────────────────────────

insert into public.configuracion (clave, valor)
values ('almacen', '{"factorSobrante": 1.5, "prefijoPlancha": "PL"}'::jsonb)
on conflict (clave) do nothing;

-- La configuración es de Administración; esto es lo que el resto necesita de ella
-- para ver el precio de un sobrante y el código de una plancha nueva.
create function public.config_almacen()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select valor from public.configuracion where clave = 'almacen'),
    '{"factorSobrante": 1.5, "prefijoPlancha": "PL"}'::jsonb
  )
  where public.auth_rol() is not null
$$;

revoke execute on function public.config_almacen() from public, anon;
grant execute on function public.config_almacen() to authenticated;
