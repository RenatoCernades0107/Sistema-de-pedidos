-- Productos terminados → plantillas del motor CAD.
--
-- Un producto estándar que una plantilla del motor (`cad/motor/plantillas/`)
-- sabe dibujar guarda aquí cuál es y con qué parámetros: así el editor del
-- terminado muestra el modelo 3D y el despiece real, y se puede abrir como
-- diseño en /disenos. Los que ninguna plantilla cubre quedan en null y siguen
-- estimándose por su forma (`geometria`, `lib/terminados/piezas.ts`).
--
--   plantilla_cad   código de la plantilla: "caja", "anfora", "letras"…
--   parametros_cad  sus parámetros en MILÍMETROS (el catálogo guarda cm): los
--                   de la primera medida del producto, su primer espesor
--                   recomendado y los fijos de su forma (tapa, niveles…).
--
-- Qué medida va a qué parámetro es la misma tabla de
-- `lib/terminados/plantilla-cad.ts` (MEDIDAS_DE_PLANTILLA).

alter table public.pt_productos
  add column plantilla_cad text check (plantilla_cad ~ '^[a-z0-9_-]{1,80}$'),
  add column parametros_cad jsonb check (jsonb_typeof(parametros_cad) = 'object'),
  add constraint pt_productos_plantilla_cad_completa
    check ((plantilla_cad is null) = (parametros_cad is null));

comment on column public.pt_productos.plantilla_cad is
  'Plantilla del motor CAD que dibuja el producto; null si ninguna lo cubre.';
comment on column public.pt_productos.parametros_cad is
  'Parámetros de la plantilla, en mm, para la primera medida del producto.';

with reglas (codigo, plantilla, fijos) as (
  values
    ('CAJ-001', 'caja', '{"con_tapa": true, "tipo_tapa": "con_pestana"}'::jsonb),
    ('CAJ-002', 'caja', '{}'::jsonb),
    ('CAJ-003', 'caja', '{}'::jsonb),
    ('CAJ-004', 'caja', '{}'::jsonb),
    ('CAJ-005', 'caja', '{}'::jsonb),
    ('CAJ-006', 'caja', '{}'::jsonb),
    ('CAJ-007', 'caja', '{"con_tapa": true}'::jsonb),
    ('CAJ-008', 'caja', '{}'::jsonb),
    ('CAJ-009', 'caja', '{}'::jsonb),
    ('CAJ-010', 'caja', '{}'::jsonb),
    -- Las ánforas de caja recta; las cilíndricas, hexagonales, de casa,
    -- piramidales y de domo no tienen plantilla.
    ('ANF-001', 'anfora', '{}'::jsonb),
    ('ANF-002', 'anfora', '{}'::jsonb),
    ('ANF-009', 'anfora', '{"con_cerradura": true}'::jsonb),
    ('ANF-010', 'anfora', '{}'::jsonb),
    ('ANF-011', 'anfora', '{}'::jsonb),
    ('ANF-012', 'anfora', '{"tapa_desmontable": true}'::jsonb),
    ('ANF-013', 'anfora', '{}'::jsonb),
    ('ANF-014', 'anfora', '{}'::jsonb),
    ('DSP-002', 'display', '{"niveles": 3}'::jsonb),
    ('ATR-004', 'atril', '{}'::jsonb),
    ('PAF-004', 'porta_afiche', '{"tipo_base": "T"}'::jsonb),
    ('PAF-005', 'porta_afiche', '{"tipo_base": "L"}'::jsonb),
    ('ALZ-002', 'alzador', '{}'::jsonb),
    ('TAR-001', 'tareco', '{"con_base": false}'::jsonb),
    ('TAR-002', 'tareco', '{"con_base": true}'::jsonb),
    ('LTR-001', 'letrero', '{"texto": "", "doble_capa": true}'::jsonb),
    ('LTR-002', 'letrero', '{"texto": "", "agujeros": "0"}'::jsonb),
    ('LTR-004', 'letrero', '{"texto": ""}'::jsonb),
    ('LTR-005', 'letrero', '{"texto": "", "agujeros": "2"}'::jsonb),
    ('LET-001', 'letras', '{}'::jsonb),
    ('LET-003', 'letras', '{"con_placa": true}'::jsonb),
    ('LET-006', 'letras', '{}'::jsonb)
),
-- Qué medida (cm) va a qué parámetro (mm), por plantilla.
campos (plantilla, m1, m2, m3, altura) as (
  values
    ('caja', 'largo', 'ancho', 'alto', null),
    ('anfora', 'largo', 'ancho', 'alto', null),
    ('alzador', 'largo', 'ancho', 'alto', null),
    ('display', 'ancho', 'fondo', 'alto', null),
    ('porta_afiche', 'ancho', 'alto', 'fondo', null),
    ('atril', 'ancho', 'alto', null, null),
    ('tareco', 'largo', 'alto', null, null),
    ('letrero', 'ancho', 'alto', null, null),
    ('letras', null, null, null, 'alto_letra')
),
primera_medida as (
  select distinct on (producto) *
    from public.pt_medidas
   order by producto, orden, id
),
primer_espesor as (
  select distinct on (producto) producto, espesor_min_mm
    from public.pt_espesores
   order by producto, orden, id
),
calculados as (
  select r.codigo, r.plantilla,
         r.fijos
         || jsonb_strip_nulls(jsonb_build_object(
              coalesce(c.m1, '_m1'), (m.medida_1_cm * 10)::float8,
              coalesce(c.m2, '_m2'), (m.medida_2_cm * 10)::float8,
              coalesce(c.m3, '_m3'), (m.medida_3_cm * 10)::float8,
              coalesce(c.altura, '_altura'), (m.altura_cm * 10)::float8,
              'espesor', e.espesor_min_mm::float8
            )) - array['_m1', '_m2', '_m3', '_altura'] as parametros
    from reglas r
    join campos c using (plantilla)
    left join primera_medida m on m.producto = r.codigo
    left join primer_espesor e on e.producto = r.codigo
)
update public.pt_productos p
   set plantilla_cad = k.plantilla,
       parametros_cad = k.parametros
  from calculados k
 where p.codigo = k.codigo;
