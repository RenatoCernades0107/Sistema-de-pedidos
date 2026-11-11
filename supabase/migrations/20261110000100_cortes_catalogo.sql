-- Cortes: la configuración del cálculo y el catálogo de planchas.
--
-- Un corte ("10 piezas de 60×80 en acrílico cristal de 3 mm") no existe como
-- producto en Odoo. La app calcula cuántas planchas consume, de qué formato
-- conviene y cuánto cuesta (`lib/cortes/`). Para eso necesita dos cosas que
-- Odoo no da al ritmo del teclado:
--
--   configuracion     los parámetros del cálculo, que Administración edita
--   grupos_plancha    un material en un color y un espesor: lo que el cliente pide
--   formatos_plancha  los tamaños en que viene ese grupo, cada uno con su
--                     código de Odoo (`default_code`)
--
-- Los formatos son estándar y cambian poco: tenerlos aquí permite calcular al
-- instante y preguntarle a Odoo solo el stock de los tres mejores candidatos.
-- El precio NO se guarda: sale de Odoo, por el código.

create table public.configuracion (
  clave text primary key check (btrim(clave) <> ''),
  valor jsonb not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references public.usuarios (id) default auth.uid()
);

comment on table public.configuracion is
  'Parámetros que Administración edita en /configuracion. Una fila por tema; `cortes` es el cálculo de cortes.';

create trigger configuracion_actualizado_en
  before update on public.configuracion
  for each row execute function public.tocar_actualizado_en();

create table public.grupos_plancha (
  id uuid primary key default gen_random_uuid(),

  material   text not null check (btrim(material) <> ''),
  -- "Cristal", "Blanco", "Colores", "Espejo"… Vacío si el material no la tiene.
  variante   text not null default '',
  -- "Lechoso", "Dorado", "White (KS-003)"… Lo que distingue dentro de la variante.
  detalle    text not null default '',
  espesor_mm numeric(5, 2) not null check (espesor_mm > 0),

  -- Si las piezas se pueden girar 90° al acomodarlas. No, cuando el material
  -- tiene dibujo o veta: mármol, tornasol, 3D.
  rotable boolean not null default true,

  -- El piloto de sobrantes, grupo por grupo. Apagado, un corte descuenta la
  -- plancha entera; encendido, registra en Odoo lo que sobra, pieza por pieza.
  sobrantes_activo boolean not null default false,

  unique (material, variante, detalle, espesor_mm)
);

create table public.formatos_plancha (
  id       uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos_plancha (id) on delete cascade,

  -- La referencia interna de Odoo. Por aquí se encuentran el producto, su precio
  -- y su stock.
  codigo_odoo text not null unique check (btrim(codigo_odoo) <> ''),

  ancho_cm numeric(7, 2) not null check (ancho_cm > 0),
  largo_cm numeric(7, 2) not null check (largo_cm > 0),

  -- Un solo código en Odoo para todos los colores: el stock que diga Odoo no es
  -- el de un color en particular, y la pantalla lo avisa.
  sku_compartido boolean not null default false,
  -- El código o la medida están por confirmar contra Odoo.
  por_verificar  boolean not null default false,
  nota text,

  activo boolean not null default true
);

create index formatos_plancha_grupo_idx on public.formatos_plancha (grupo_id);

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Cotizar y registrar pedidos es de Administración, y con ellos el catálogo y
-- los precios del corte. El taller no lee nada de aquí: ve el resultado del
-- cálculo, guardado en el pedido.

alter table public.configuracion    enable row level security;
alter table public.grupos_plancha   enable row level security;
alter table public.formatos_plancha enable row level security;

create policy configuracion_admin on public.configuracion
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy grupos_plancha_admin on public.grupos_plancha
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy formatos_plancha_admin on public.formatos_plancha
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

revoke all on public.configuracion, public.grupos_plancha, public.formatos_plancha
  from anon, authenticated;
grant select, insert, update, delete
  on public.configuracion, public.grupos_plancha, public.formatos_plancha to authenticated;

-- ── El catálogo ─────────────────────────────────────────────────────────────
-- Las 244 planchas de la lista de la empresa (noviembre de 2026), con su código
-- de Odoo. A partir de aquí se mantiene desde /configuracion.

with datos (
  material, variante, detalle, espesor_mm, ancho_cm, largo_cm, codigo_odoo,
  sku_compartido, por_verificar, nota, rotable
) as (
  values
    ('Acrílico ECO', 'Cristal', '', 1.8, 122, 183, 'F7E001', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 1.8, 122, 183, 'F7E002', false, false, 'Grupo: F7E002 / F7E070', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 1.8, 122, 183, 'F7E070', false, false, 'Grupo: F7E002 / F7E070', true),
    ('Acrílico ECO', 'Colores', 'Negro', 1.8, 122, 183, 'F7E043', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 2, 122, 183, 'F7E004', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 2, 122, 183, 'F7E005', false, false, 'Grupo: F7E005 / F7E071', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 2, 122, 183, 'F7E071', false, false, 'Grupo: F7E005 / F7E071', true),
    ('Acrílico ECO', 'Colores', 'Negro', 2, 122, 183, 'F7E006', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 2.5, 122, 183, 'F7E017', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 2.5, 122, 183, 'F7E018', false, false, 'Grupo: F7E018 / F7E080. Corregido: en tu lista decía F7E0018 (la lista de precios dice F7E018)', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 2.5, 122, 183, 'F7E080', false, false, 'Grupo: F7E018 / F7E080', true),
    ('Acrílico ECO', 'Colores', 'Negro', 2.5, 122, 183, 'F7E019', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 3, 122, 183, 'F7E024', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 3, 122, 183, 'F7E025', false, false, 'Blanco', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 3, 122, 183, 'F7E072', false, false, 'Blanco lechoso', true),
    ('Acrílico ECO', 'Blanco', 'Opalino', 3, 122, 183, 'F7E054', false, false, 'Blanco opalino', true),
    ('Acrílico ECO', 'Colores', 'Negro', 3, 122, 183, 'F7E029', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 4, 122, 183, 'F7E036', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 4, 122, 183, 'F7E038', false, false, 'Grupo: F7E038 / F7E079', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 4, 122, 183, 'F7E079', false, false, 'Grupo: F7E038 / F7E079', true),
    ('Acrílico ECO', 'Colores', 'Negro', 4, 122, 183, 'F7E053', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 4.8, 122, 183, 'F7E037', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 4.8, 122, 183, 'F7E061', false, false, 'Grupo: F7E061 / F7E081', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 4.8, 122, 183, 'F7E081', false, false, 'Grupo: F7E061 / F7E081', true),
    ('Acrílico ECO', 'Colores', 'Negro', 4.8, 122, 183, 'F7E062', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 6, 122, 183, 'F7E039', false, false, 'Corregido · Corregido: en tu lista decía F7E049 (confirmado: es F7E039; F7E049 es el blanco de 9.8 mm)', true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 6, 122, 183, 'F7E047', false, false, 'Grupo: F7E047 / F7E082', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 6, 122, 183, 'F7E082', false, false, 'Grupo: F7E047 / F7E082', true),
    ('Acrílico ECO', 'Colores', 'Negro', 6, 122, 183, 'F7E063', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 8, 122, 183, 'F7E040', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 8, 122, 183, 'F7E048', false, false, null, true),
    ('Acrílico ECO', 'Colores', 'Negro', 8, 122, 183, 'F7E083', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 9.8, 122, 183, 'F7E041', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 9.8, 122, 183, 'F7E049', false, false, null, true),
    ('Acrílico ECO', 'Colores', 'Negro', 9.8, 122, 183, 'F7E073', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 12, 122, 183, 'F7E078', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 15, 122, 183, 'F7E042', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 18, 122, 183, 'F7E074', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 20, 122, 183, 'F7E050', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 25, 122, 183, 'F7E051', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 2, 122, 244, 'F9.5E003', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 2, 122, 244, 'F9.5E007', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 2.5, 122, 244, 'F9.5E013', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 2.5, 122, 244, 'F9.5E008', false, false, null, true),
    ('Acrílico ECO', 'Mate', 'Cristal', 2.5, 122, 244, 'F9.5E005', false, false, 'Grupo: F9.5E005 / F9.5E006 / F9.5E014', true),
    ('Acrílico ECO', 'Mate', 'Negro', 2.5, 122, 244, 'F9.5E006', false, false, 'Grupo: F9.5E005 / F9.5E006 / F9.5E014', true),
    ('Acrílico ECO', 'Mate', 'Blanco', 2.5, 122, 244, 'F9.5E014', false, false, 'Grupo: F9.5E005 / F9.5E006 / F9.5E014', true),
    ('Acrílico ECO', 'Cristal', '', 3, 122, 244, 'F9.5E015', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 3, 122, 244, 'F9.5E011', false, false, 'Grupo: F9.5E011 / F9.5E018', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 3, 122, 244, 'F9.5E018', false, false, 'Grupo: F9.5E011 / F9.5E018', true),
    ('Acrílico ECO', 'Mate', 'Cristal', 3, 122, 244, 'F9.5E001', false, false, 'Grupo: F9.5E001 / F9.5E012', true),
    ('Acrílico ECO', 'Mate', 'Blanco', 3, 122, 244, 'F9.5E012', false, false, 'Grupo: F9.5E001 / F9.5E012', true),
    ('Acrílico ECO', 'Mate', 'Cristal', 4, 122, 244, 'F9.5E002', false, false, null, true),
    ('Acrílico ECO', 'Mate', 'Cristal', 6, 122, 244, 'F9.5E016', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 9.8, 122, 244, 'F9.5E025', false, false, null, true),
    ('Acrílico ECO', 'Mate', 'Cristal', 9.8, 122, 244, 'F9.5E017', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 20, 122, 244, 'F9.5E009', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 25, 122, 244, 'F9.5E010', false, false, 'Corregido · Normalizado: en la lista de precios figura como F9.5e010 (minúscula)', true),
    ('Acrílico ECO', 'Cristal', '', 40, 122, 244, 'F9.5E023', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 2.7, 150, 300, 'F15E001', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 2.7, 150, 300, 'F15E002', false, false, null, true),
    ('Acrílico ECO', 'Colores', 'Negro', 2.7, 150, 300, 'F15E003', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 3, 150, 300, 'F15E004', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 3, 150, 300, 'F15E005', false, false, null, true),
    ('Acrílico ECO', 'Colores', 'Negro', 3, 150, 300, 'F15E006', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 4, 150, 300, 'F15E007', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 4, 150, 300, 'F15E008', false, false, 'Grupo: F15E008 / F15E014', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 4, 150, 300, 'F15E014', false, false, 'Grupo: F15E008 / F15E014', true),
    ('Acrílico ECO', 'Colores', 'Negro', 4, 150, 300, 'F15E012', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 4.8, 150, 300, 'F15E010', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 4.8, 150, 300, 'F15E009', false, false, 'Grupo: F15E009 / F15E017', true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 4.8, 150, 300, 'F15E017', false, false, 'Grupo: F15E009 / F15E017', true),
    ('Acrílico ECO', 'Cristal', '', 6, 150, 300, 'F15E011', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Lechoso', 6, 150, 300, 'F15E013', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 8, 150, 300, 'F15E015', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 9.8, 150, 300, 'F15E016', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 2.7, 205, 305, 'F20E001', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 2.7, 205, 305, 'F20E002', false, false, null, true),
    ('Acrílico ECO', 'Colores', 'Negro', 2.7, 205, 305, 'F20E003', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 3, 205, 305, 'F20E004', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 3, 205, 305, 'F20E005', false, false, 'Grupo: F20E005 / F20E009', true),
    ('Acrílico ECO', 'Blanco', 'Opalino', 3, 205, 305, 'F20E009', false, false, 'Grupo: F20E005 / F20E009', true),
    ('Acrílico ECO', 'Colores', 'Negro', 3, 205, 305, 'F20E006', true, false, 'Grupo: F20E006 / F20E011', true),
    ('Acrílico ECO', 'Colores', 'Bronce', 3, 205, 305, 'F20E011', true, false, 'Grupo: F20E006 / F20E011', true),
    ('Acrílico ECO', 'Cristal', '', 4, 205, 305, 'F20E007', false, false, null, true),
    ('Acrílico ECO', 'Blanco', 'Semi-traslucido', 4, 205, 305, 'F20E008', false, false, 'Grupo: F20E008 / F20E010', true),
    ('Acrílico ECO', 'Blanco', 'Opalino', 4, 205, 305, 'F20E010', false, false, 'Grupo: F20E008 / F20E010', true),
    ('Acrílico ECO', 'Colores', 'Negro', 4, 205, 305, 'F20E014', true, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 4.8, 205, 305, 'F20E012', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 6, 205, 305, 'F20E013', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 8, 205, 305, 'F20E019', false, false, null, true),
    ('Acrílico ECO', 'Cristal', '', 9.8, 205, 305, 'F20E017', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 1.5, 125, 185, 'F7001', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 1.5, 125, 185, 'F7002', false, true, 'Falta corregir medida en Odoo · Grupo: F7002 / F7003', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 1.5, 125, 185, 'F7003', false, false, 'Grupo: F7002 / F7003', true),
    ('Acrílico Premium', 'Colores', 'Gris', 1.5, 125, 185, 'F7005', true, false, 'Grupo: F7005 / F7006', true),
    ('Acrílico Premium', 'Colores', 'Negro', 1.5, 125, 185, 'F7006', true, false, 'Grupo: F7005 / F7006', true),
    ('Acrílico Premium', 'Cristal', '', 2, 125, 185, 'F7008', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 2, 125, 185, 'F7009', false, false, 'Grupo: F7009 / F7010', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 2, 125, 185, 'F7010', false, false, 'Grupo: F7009 / F7010', true),
    ('Acrílico Premium', 'Mate', 'Cristal', 2, 125, 185, 'F7014', true, false, 'Grupo: F7014 / F7011', true),
    ('Acrílico Premium', 'Colores', 'Negro', 2, 125, 185, 'F7011', true, false, 'Grupo: F7014 / F7011', true),
    ('Acrílico Premium', 'Cristal', '', 2.5, 125, 185, 'F7244', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 2.5, 125, 185, 'F7245', false, true, 'Por verificar (multi-código) · Grupo: F7245 / F7246', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 2.5, 125, 185, 'F7246', false, true, 'Por verificar (multi-código) · Grupo: F7245 / F7246', true),
    ('Acrílico Premium', 'Mate', 'Cristal', 2.5, 125, 185, 'F7250', true, true, 'Por verificar (multi-código) · Grupo: F7250 / F7247', true),
    ('Acrílico Premium', 'Colores', 'Negro', 2.5, 125, 185, 'F7247', true, true, 'Por verificar (multi-código) · Grupo: F7250 / F7247', true),
    ('Acrílico Premium', 'Cristal', '', 3, 125, 185, 'F7016', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 3, 125, 185, 'F7018', false, false, 'Grupo: F7018 / F7019', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 3, 125, 185, 'F7019', false, false, 'Grupo: F7018 / F7019', true),
    ('Acrílico Premium', 'Colores', 'Rojo traslucido', 3, 125, 185, 'F7017', true, true, 'Por verificar (multi-código) · Grupo: F7023 / F7020', true),
    ('Acrílico Premium', 'Colores', 'Negro', 3, 125, 185, 'F7020', true, false, 'Grupo: F7023 / F7020', true),
    ('Acrílico Premium', 'Cristal', '', 4, 125, 185, 'F7025', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 4, 125, 185, 'F7027', false, false, 'Grupo: F7027 / F7028', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 4, 125, 185, 'F7028', false, false, 'Grupo: F7027 / F7028', true),
    ('Acrílico Premium', 'Cristal', 'Alto impacto', 4, 125, 185, 'F7033', true, true, 'Por verificar (multi-código) · Grupo: F7033 / F7029', true),
    ('Acrílico Premium', 'Colores', 'Negro', 4, 125, 185, 'F7029', true, false, 'Grupo: F7033 / F7029', true),
    ('Acrílico Premium', 'Cristal', '', 4.8, 125, 185, 'F7034', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 4.8, 125, 185, 'F7035', false, false, 'Grupo: F7035 / F7036', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 4.8, 125, 185, 'F7036', false, false, 'Grupo: F7035 / F7036', true),
    ('Acrílico Premium', 'Colores', 'Negro', 4.8, 125, 185, 'F7071', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 6, 125, 185, 'F7038', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 6, 125, 185, 'F7039', false, false, 'Grupo: F7039 / F7040', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 6, 125, 185, 'F7040', false, false, 'Grupo: F7039 / F7040', true),
    ('Acrílico Premium', 'Mate', 'Cristal', 6, 125, 185, 'F7041', true, false, null, true),
    ('Acrílico Premium', 'Colores', 'Negro', 6, 125, 185, 'F7065', true, false, 'Código también en Acrílico Premium 122×183 6 mm (colores) y Acrílico espejo 122×183 6 mm plateado', true),
    ('Acrílico Premium', 'Cristal', '', 8, 125, 185, 'F7042', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 9.8, 125, 185, 'F7043', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 9.8, 125, 185, 'F7044', false, true, 'Por verificar (multi-código) · Grupo: F7044 / F7252', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 9.8, 125, 185, 'F7252', false, true, 'Por verificar (multi-código) · Grupo: F7044 / F7252', true),
    ('Acrílico Premium', 'Mate', 'Cristal', 9.8, 125, 185, 'F7253', true, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 12, 125, 185, 'F7045', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 15, 122, 183, 'F7046', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 18, 122, 183, 'F7047', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 20, 122, 183, 'F7048', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 25, 122, 183, 'F7049', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 30, 122, 183, 'F7050', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 40, 122, 183, 'F7051', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 50, 122, 183, 'F7052', false, false, null, true),
    ('Acrílico Premium', 'Marmol', 'Salmon', 3, 122, 244, 'F9.5059', false, false, null, false),
    ('Acrílico Premium', 'Marmol', 'Perla', 3, 122, 244, 'F9.5058', false, false, null, false),
    ('Acrílico Premium', 'Cristal', '', 4, 122, 244, 'F9.5085', false, false, 'Código también en Acrílico ECO y Premium 122×244 4 mm', true),
    ('Acrílico Premium', 'Cristal', '', 4.8, 122, 244, 'F9.5087', false, false, 'Código también en Acrílico ECO 122×244 6 mm y Premium 122×244 4.8 mm', true),
    ('Acrílico Premium', 'Cristal', '', 6, 122, 244, 'F9.5088', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 3, 205, 305, 'F20100', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 3, 205, 305, 'F20101', false, false, 'Grupo: F20101 / F20108', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 3, 205, 305, 'F20108', false, false, 'Grupo: F20101 / F20108', true),
    ('Acrílico Premium', 'Cristal', '', 4, 205, 305, 'F20102', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 4, 205, 305, 'F20103', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 4.5, 205, 305, 'F20104', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 6, 205, 305, 'F20105', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 6, 205, 305, 'F20106', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 9.8, 205, 305, 'F20107', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 4, 188, 249, 'F14098', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 4.8, 188, 249, 'F14001', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 6, 188, 249, 'F14002', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 2.5, 158, 249, 'F8053', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 2.5, 158, 249, 'F8054', false, false, 'Grupo: F8054 / F8055', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 2.5, 158, 249, 'F8055', false, false, 'Grupo: F8054 / F8055', true),
    ('Acrílico Premium', 'Colores', 'Negro', 2.5, 158, 249, 'F8056', true, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 3, 158, 249, 'F8059', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 3, 158, 249, 'F8060', false, false, 'Grupo: F8060 / F8061', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 3, 158, 249, 'F8061', false, false, 'Grupo: F8060 / F8061', true),
    ('Acrílico Premium', 'Colores', 'Negro', 3, 158, 249, 'F8062', true, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 4, 158, 249, 'F8063', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 4, 158, 249, 'F8064', false, false, 'Grupo: F8064 / F8065', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 4, 158, 249, 'F8065', false, false, 'Grupo: F8064 / F8065', true),
    ('Acrílico Premium', 'Colores', 'Negro', 4, 158, 249, 'F8066', true, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 4.8, 158, 249, 'F8067', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 4.8, 158, 249, 'F8068', false, false, 'Grupo: F8068 / F8069', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 4.8, 158, 249, 'F8069', false, false, 'Grupo: F8068 / F8069', true),
    ('Acrílico Premium', 'Colores', 'Negro', 4.8, 158, 249, 'F8070', true, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 6, 158, 249, 'F8071', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 6, 158, 249, 'F8072', false, false, 'Grupo: F8072 / F8073', true),
    ('Acrílico Premium', 'Blanco', 'Opalino', 6, 158, 249, 'F8073', false, false, 'Grupo: F8072 / F8073', true),
    ('Acrílico Premium', 'Colores', 'Negro', 6, 158, 249, 'F8074', true, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 8, 158, 249, 'F8075', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 9.8, 158, 249, 'F8076', false, false, null, true),
    ('Acrílico Premium', 'Blanco', 'Lechoso', 9.8, 158, 249, 'F8077', false, false, null, true),
    ('Acrílico Premium', 'Cristal', '', 12, 158, 249, 'F8078', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 0.6, 122, 244, 'PC009', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 1, 122, 244, 'PC013', false, false, 'Código también en PC sólido Nudec y NAC 122×244 1 mm', true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 2, 205, 305, 'PC001', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 3, 205, 305, 'PC002', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 4, 205, 305, 'PC003', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 5, 205, 305, 'PC006', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 6, 205, 305, 'PC004', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Bronce', '', 6, 205, 305, 'PC008', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 8, 205, 305, 'PC007', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 10, 205, 305, 'PC005', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 0.7, 110, 1000, 'PC018', false, false, null, true),
    ('Policarbonato sólido Nudec', 'Cristal', '', 0.8, 110, 244, 'PC015', false, false, 'Código también en PC sólido Nudec y NAC 110×244 0.8 mm', true),
    ('Policarbonato sólido NAC', 'Cristal', '', 0.6, 122, 244, 'PC011', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 2, 122, 244, 'PC034', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 3, 122, 244, 'PC035', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 4, 122, 244, 'PC028', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 6, 122, 244, 'PC042', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 2, 205, 305, 'PC020', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 3, 205, 305, 'PC021', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 4, 205, 305, 'PC022', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 5, 205, 305, 'PC023', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 6, 205, 305, 'PC024', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 8, 205, 305, 'PC025', false, false, null, true),
    ('Policarbonato sólido NAC', 'Cristal', '', 10, 205, 305, 'PC026', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Plateado', 2, 122, 183, 'F7273', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Plateado + Adhesivo', 2, 122, 183, 'F7E351', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Dorado', 2, 122, 183, 'F7274', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Fucsia', 2, 122, 183, 'F7E350', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Rojo', 2, 122, 183, 'F7343', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Azul', 2, 122, 183, 'F7276', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Verde', 2, 122, 183, 'F7E344', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Rosado', 2, 122, 183, 'F7E342', false, false, 'Existe también F7257 (duplicado creado por error).', true),
    ('Acrílico espejo', 'Espejo', 'Plateado', 2.5, 122, 183, 'F7279', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Dorado', 2.5, 122, 183, 'F7280', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Plateado', 3, 122, 183, 'F7E348', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Dorado', 3, 122, 183, 'F7E349', false, false, null, true),
    ('Acrílico espejo', 'Espejo', 'Plateado', 6, 122, 183, 'F7111', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Perspectivo – 3D Traslúcido', 2.5, 122, 183, 'F7E097', false, false, null, false),
    ('Acrílico especial', 'Especial', 'Tornasolado – Tornasol', 2.5, 122, 183, 'F7E096', false, false, 'En la lista de precios figura como F9.5E096 (prefijo de 1.22×2.44); dejado como en tu lista.', false),
    ('Acrílico especial', 'Especial', 'Black & Led, Satinado – Negro', 3, 122, 183, 'F7326', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Tornasolado – Tornasol', 5, 122, 183, 'F7E095', false, false, null, false),
    ('Acrílico especial', 'Especial', 'Glitter – Dorado', 2.6, 122, 244, 'F9.5E020', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Glitter – Rojo', 2.6, 122, 244, 'F9.5E019', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Glitter – Plateado', 2.6, 122, 244, 'F9.5E022', false, false, 'En la lista de precios el plateado figura como ''F9.5E021/22''; F9.5E021 no está en tu lista.', true),
    ('Acrílico especial', 'Especial', 'Anti-Reflejante – Non-Glare', 4, 122, 244, 'F9.5001', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Anti-Reflejante – Non-Glare', 4.8, 122, 244, 'F9.5002', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Grado Marino – Superficies Sólidas Novanite – Blanco', 6, 122, 244, 'NV099-6', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Grado Marino – Superficies Sólidas Novanite – Blanco', 12, 122, 244, 'NV-099', false, false, 'En tu lista ''NV-099''; en la lista de precios ''NV099'' (sin guion). Confirmar en Odoo.', true),
    ('Acrílico especial', 'Especial', 'Grado Marino – Superficies Sólidas Novanite – Negro', 12, 122, 244, 'NV402', false, false, null, true),
    ('Acrílico especial', 'Especial', 'Grado Marino – Superficies Sólidas Novanite – Mostaza', 12, 122, 244, 'NV120', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'White (KS-003)', 12, 76, 368, 'SS001', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Mocha (KP-301)', 12, 76, 368, 'SS013', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Sahara (KM-103)', 12, 76, 368, 'SS006', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'White Moon (KP-460)', 12, 76, 368, 'SS007', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Orange (KS-010)', 12, 76, 368, 'SS008', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Green (KS-036)', 12, 76, 368, 'SS009', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'White Terrazo (KT-002)', 12, 76, 368, 'SS003', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Grass Grey (KA-808)', 12, 76, 368, 'SS004', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Metalic Galaxy (KA-815)', 12, 76, 368, 'SS005', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Sanded Gold (KVA-1016)', 12, 76, 368, 'SS010', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'Aurora Greice (KVA-1021)', 12, 76, 368, 'SS011', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'White Sand (KVA-1030)', 12, 76, 368, 'SS012', false, false, null, true),
    ('Superficie sólida de acrílico', '', 'White (KS-003)', 6, 122, 244, 'SS002', false, false, null, true),
    ('Acrílico modificado', '', 'Green Crystal (LVA-3512)', 12, 76, 368, 'SSAM001', false, false, null, true)
),
grupos as (
  insert into public.grupos_plancha (material, variante, detalle, espesor_mm, rotable)
  select material, variante, detalle, espesor_mm, bool_and(rotable)
    from datos
   group by material, variante, detalle, espesor_mm
  returning id, material, variante, detalle, espesor_mm
)
insert into public.formatos_plancha (
  grupo_id, codigo_odoo, ancho_cm, largo_cm, sku_compartido, por_verificar, nota
)
select g.id, d.codigo_odoo, d.ancho_cm, d.largo_cm, d.sku_compartido, d.por_verificar, d.nota
  from datos d
  join grupos g
    on g.material = d.material and g.variante = d.variante
   and g.detalle = d.detalle and g.espesor_mm = d.espesor_mm;
