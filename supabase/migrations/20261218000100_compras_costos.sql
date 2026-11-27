-- Compras y costos: la compra deja de ser un ingreso de stock de un solo paso.
--
-- Antes: Almacén → Ingresar stock → Compra creaba la orden en Odoo y la daba por
-- recibida en el acto, con un costo por unidad en soles y nada más.
--
-- Ahora (ver docs/proceso-compras.svg):
--   pre-compra (borrador) → confirmar (orden de compra en Odoo) → Almacén recibe
--   contra la orden (puede ser por partes) → se cargan los gastos → liquidación.
-- La liquidación reparte los gastos entre los ítems (`lib/costeo.ts`) y deja el
-- costo de adquisición de cada plancha en `costos_historial`.
--
-- Esta migración:
--   1. Quién gestiona compras (Administración y Logística).
--   2. `compras`, sus ítems y sus gastos.
--   3. Las recepciones de una compra (lo que llegó, cuándo y a qué almacén).
--   4. El historial de costos, con lo que ya había en los ingresos de compra.
--   5. Márgenes por plancha y el historial de precios (Administración).
--   6. La configuración de costos y precios, y la tarifa de mano de obra para Logística.

-- ── 1. Quién gestiona compras ───────────────────────────────────────────────

create function public.gestiona_compras()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_rol() in ('administracion', 'logistica'), false)
$$;

revoke execute on function public.gestiona_compras() from public, anon;
grant execute on function public.gestiona_compras() to authenticated;

-- ── 2. Compras ──────────────────────────────────────────────────────────────

create sequence public.compras_numero_seq;

create table public.compras (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('CMP-' || lpad(nextval('public.compras_numero_seq')::text, 5, '0')),
  tipo text not null check (tipo in ('nacional', 'importacion')),
  -- borrador: la pre-compra, se edita libre. confirmada: ya es orden de compra en
  -- Odoo. recibida_parcial / recibida: según lo que Almacén recibió. liquidada:
  -- el costo quedó en el historial. anulada: no va.
  estado text not null default 'borrador'
    check (estado in ('borrador', 'confirmada', 'recibida_parcial', 'recibida', 'liquidada', 'anulada')),

  proveedor_odoo_id integer not null check (proveedor_odoo_id > 0),
  proveedor_nombre text not null,
  -- El almacén al que llega (la recepción de Odoo de ese almacén).
  almacen_id uuid not null references public.almacenes (id) on delete restrict,
  -- La proforma o la cotización del proveedor.
  documento_proveedor text check (documento_proveedor is null or btrim(documento_proveedor) <> ''),

  moneda_mercaderia text not null default 'PEN' check (moneda_mercaderia in ('PEN', 'USD')),
  -- Soles por dólar: uno para la mercadería y otro para los gastos.
  tc_mercaderia numeric(8, 4) check (tc_mercaderia is null or tc_mercaderia > 0),
  tc_gastos numeric(8, 4) check (tc_gastos is null or tc_gastos > 0),
  incoterm text check (incoterm is null or incoterm in ('FOB', 'CIF')),
  check (tipo = 'importacion' or incoterm is null),

  condicion_pago text not null default 'contado'
    check (condicion_pago in ('contado', 'contra_entrega', 'adelantado', 'credito')),
  -- El crédito de importación se cuenta desde el embarque.
  dias_credito smallint check (dias_credito is null or dias_credito between 1 and 365),
  check (condicion_pago <> 'credito' or dias_credito is not null),
  fecha_embarque date,
  fecha_llegada_estimada date,
  nota text,

  odoo_orden_id integer,
  sincronizacion public.sincronizacion_odoo,
  error_sincronizacion text,

  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  confirmada_en timestamptz,
  liquidada_por uuid references public.usuarios (id),
  liquidada_en timestamptz
);

create index compras_creado_idx on public.compras (creado_en desc);
create index compras_estado_idx on public.compras (estado);

create table public.compras_lineas (
  compra_id uuid not null references public.compras (id) on delete cascade,
  posicion smallint not null check (posicion > 0),
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  cantidad integer not null check (cantidad > 0 and cantidad <= 99999),
  -- Los kilos del ítem completo, como vienen en el PDF del proveedor.
  kilos numeric(12, 3) check (kilos is null or kilos > 0),
  -- En la moneda de la mercadería.
  precio_unitario numeric(14, 6) not null check (precio_unitario >= 0),
  -- El total del PDF, para cuadrar con cantidad × precio.
  total_proveedor numeric(14, 2) check (total_proveedor is null or total_proveedor >= 0),
  cantidad_recibida integer not null default 0 check (cantidad_recibida >= 0 and cantidad_recibida <= cantidad),
  primary key (compra_id, posicion),
  unique (compra_id, producto_odoo_id)
);

create table public.compras_gastos (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id) on delete cascade,
  concepto text not null check (concepto in (
    'flete_maritimo', 'seguro', 'ad_valorem', 'ipm', 'igv', 'percepcion_igv',
    'agente_aduanas', 'visto_bueno', 'almacen_aduanero', 'sobreestadia',
    'transporte', 'montacarga', 'mano_obra', 'combustible', 'otro'
  )),
  descripcion text,
  moneda text not null check (moneda in ('PEN', 'USD')),
  -- Para la mano de obra es personas × horas × tarifa (lo calcula la app y se guarda).
  monto numeric(14, 2) not null check (monto >= 0),
  reparto text not null check (reparto in ('valor', 'peso', 'cantidad', 'no_costo')),
  tipo_mano_obra text check (tipo_mano_obra is null or tipo_mano_obra in ('descarga', 'supervision', 'despacho')),
  personas numeric(6, 2) check (personas is null or personas >= 0),
  horas numeric(8, 2) check (horas is null or horas >= 0),
  tarifa numeric(10, 2) check (tarifa is null or tarifa >= 0),
  check (concepto <> 'mano_obra' or (tipo_mano_obra is not null and personas is not null and horas is not null and tarifa is not null)),
  fecha_pago date,
  documento text,
  creado_en timestamptz not null default now()
);

create index compras_gastos_compra_idx on public.compras_gastos (compra_id);

alter table public.compras enable row level security;
alter table public.compras_lineas enable row level security;
alter table public.compras_gastos enable row level security;

create policy compras_gestion on public.compras
  for all to authenticated using (public.gestiona_compras()) with check (public.gestiona_compras());
create policy compras_lineas_gestion on public.compras_lineas
  for all to authenticated using (public.gestiona_compras()) with check (public.gestiona_compras());
create policy compras_gastos_gestion on public.compras_gastos
  for all to authenticated using (public.gestiona_compras()) with check (public.gestiona_compras());

revoke all on public.compras, public.compras_lineas, public.compras_gastos from anon, authenticated;
grant select, insert, update, delete on public.compras, public.compras_lineas, public.compras_gastos to authenticated;
revoke all on sequence public.compras_numero_seq from anon;
grant usage on sequence public.compras_numero_seq to authenticated;

-- ── 3. Recepciones ──────────────────────────────────────────────────────────
-- Cada vez que Almacén recibe (todo o una parte). Se guarda antes de ir a Odoo:
-- si Odoo falla, queda pendiente y se reintenta, como los ingresos.

create table public.compras_recepciones (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id) on delete restrict,
  odoo_picking_id integer,
  sincronizacion public.sincronizacion_odoo not null default 'pendiente',
  error_sincronizacion text,
  nota text,
  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now()
);

create table public.compras_recepciones_lineas (
  recepcion_id uuid not null references public.compras_recepciones (id) on delete cascade,
  posicion smallint not null check (posicion > 0),
  cantidad integer not null check (cantidad > 0 and cantidad <= 99999),
  primary key (recepcion_id, posicion)
);

create index compras_recepciones_compra_idx on public.compras_recepciones (compra_id, creado_en);

alter table public.compras_recepciones enable row level security;
alter table public.compras_recepciones_lineas enable row level security;

-- Recibe quien gestiona el stock; las compras las ve quien las gestiona. Hoy son
-- los mismos roles, pero son dos permisos distintos.
create policy compras_recepciones_gestion on public.compras_recepciones
  for all to authenticated
  using (public.gestiona_stock() or public.gestiona_compras())
  with check (public.gestiona_stock());
create policy compras_recepciones_lineas_gestion on public.compras_recepciones_lineas
  for all to authenticated
  using (public.gestiona_stock() or public.gestiona_compras())
  with check (public.gestiona_stock());

revoke all on public.compras_recepciones, public.compras_recepciones_lineas from anon, authenticated;
grant select, insert, update on public.compras_recepciones, public.compras_recepciones_lineas to authenticated;

-- ── 4. Historial de costos ──────────────────────────────────────────────────
-- Una fila por plancha y compra liquidada: lo que costó poner cada plancha en
-- nuestro almacén. Re-liquidar una compra reemplaza sus filas.

create table public.costos_historial (
  id uuid primary key default gen_random_uuid(),
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  -- 'liquidacion': de una compra con sus gastos. 'ingreso': un ingreso de compra
  -- de antes de esto, solo con el costo que se escribió (sin gastos).
  origen text not null check (origen in ('liquidacion', 'ingreso')),
  compra_id uuid references public.compras (id) on delete cascade,
  ingreso_id uuid references public.ingresos_stock (id) on delete cascade,
  check ((origen = 'liquidacion') = (compra_id is not null)),
  fecha date not null,
  cantidad integer not null check (cantidad > 0),
  costo_unitario_pen numeric(14, 4) not null check (costo_unitario_pen >= 0),
  costo_unitario_usd numeric(14, 4) check (costo_unitario_usd is null or costo_unitario_usd >= 0),
  costo_kg_pen numeric(14, 4) check (costo_kg_pen is null or costo_kg_pen >= 0),
  -- { "mercaderia": 123.45, "gastos": { "flete_maritimo": 1.2, ... } } por plancha.
  desglose jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index costos_historial_producto_idx on public.costos_historial (producto_odoo_id, fecha desc, creado_en desc);
create index costos_historial_compra_idx on public.costos_historial (compra_id);

alter table public.costos_historial enable row level security;

create policy costos_historial_gestion on public.costos_historial
  for all to authenticated using (public.gestiona_compras()) with check (public.gestiona_compras());

revoke all on public.costos_historial from anon, authenticated;
grant select, insert, delete on public.costos_historial to authenticated;

-- Lo que ya había: cada ingreso de compra con costo es un punto del historial.
insert into public.costos_historial
  (producto_odoo_id, codigo, nombre, origen, ingreso_id, fecha, cantidad, costo_unitario_pen, creado_en)
select l.producto_odoo_id, l.codigo, l.nombre, 'ingreso', i.id,
       (i.creado_en at time zone 'America/Lima')::date, l.cantidad, l.costo_unitario, i.creado_en
from public.ingresos_stock i
join public.ingresos_stock_lineas l on l.ingreso_id = i.id
where i.tipo = 'compra' and l.costo_unitario is not null and l.cantidad > 0;

-- ── 5. Márgenes por plancha e historial de precios ──────────────────────────

create table public.margenes_plancha (
  codigo_odoo text primary key check (btrim(codigo_odoo) <> ''),
  margen_pct numeric(5, 2) not null check (margen_pct >= 0 and margen_pct < 100),
  actualizado_por uuid references public.usuarios (id) default auth.uid(),
  actualizado_en timestamptz not null default now()
);

create table public.cambios_precio (
  id uuid primary key default gen_random_uuid(),
  producto_odoo_id integer not null check (producto_odoo_id > 0),
  codigo text,
  nombre text not null,
  precio_anterior numeric(14, 2),
  precio_nuevo numeric(14, 2) not null check (precio_nuevo >= 0),
  -- Con qué costo y qué margen se calculó (null si se cambió a mano).
  costo_base numeric(14, 4),
  margen_pct numeric(5, 2),
  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now()
);

create index cambios_precio_producto_idx on public.cambios_precio (producto_odoo_id, creado_en desc);

alter table public.margenes_plancha enable row level security;
alter table public.cambios_precio enable row level security;

create policy margenes_plancha_admin on public.margenes_plancha
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy cambios_precio_admin on public.cambios_precio
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

revoke all on public.margenes_plancha, public.cambios_precio from anon, authenticated;
grant select, insert, update, delete on public.margenes_plancha to authenticated;
grant select, insert on public.cambios_precio to authenticated;

-- ── 6. Configuración ────────────────────────────────────────────────────────

insert into public.configuracion (clave, valor)
values ('costos_precios', jsonb_build_object(
  'margenDefecto', 30,
  'margenPorMaterial', '{}'::jsonb,
  'igvPct', 18,
  'preciosIncluyenIgv', true,
  'redondeo', 'decimo',
  'tarifasManoObra', jsonb_build_object('descarga', 0, 'supervision', 0, 'despacho', 0)
))
on conflict (clave) do nothing;

-- La configuración es de Administración. Logística necesita solo la tarifa por
-- hora de la mano de obra para cargar ese gasto en una compra.
create function public.config_tarifas_mano_obra()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select valor -> 'tarifasManoObra' from public.configuracion where clave = 'costos_precios'),
    '{"descarga": 0, "supervision": 0, "despacho": 0}'::jsonb
  )
  where public.gestiona_compras()
$$;

revoke execute on function public.config_tarifas_mano_obra() from public, anon;
grant execute on function public.config_tarifas_mano_obra() to authenticated;
