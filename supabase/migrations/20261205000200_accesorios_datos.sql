-- Los accesorios de la lista de la empresa (`supabase/seeds/productos.xlsx`, hoja
-- "Accesorios"), cada uno en su categoría. A partir de aquí se mantienen desde
-- /almacen.
--
-- ACC001 servía para todos los tornillos (6, 10, 12, 15 y 20 mm): queda como uno
-- solo, y las otras medidas se crean como productos nuevos al ingresarlas.

insert into public.categorias_accesorio (nombre, prefijo, orden) values
  ('Bisagras', 'ACC', 1),
  ('Tornillos', 'ACC', 2),
  ('Barras, tubos y perfiles', 'ACC', 3),
  ('Soportes y sujetadores', 'ACC', 4),
  ('Manijas y cerraduras', 'ACC', 5),
  ('Herramientas', 'ACC', 6),
  ('Adhesivos', 'PEG', 7);

insert into public.accesorios (codigo_odoo, categoria_id)
select v.codigo, c.id
from (values
  ('ACC003', 'Bisagras'), ('ACC004', 'Bisagras'), ('ACC005', 'Bisagras'), ('ACC007', 'Bisagras'),
  ('ACC006', 'Bisagras'), ('ACC028', 'Bisagras'), ('ACC029', 'Bisagras'), ('ACC030', 'Bisagras'),

  ('ACC001', 'Tornillos'), ('ACC041', 'Tornillos'),

  ('ACC017', 'Barras, tubos y perfiles'), ('ACC018', 'Barras, tubos y perfiles'),
  ('ACC019', 'Barras, tubos y perfiles'), ('ACC022', 'Barras, tubos y perfiles'),
  ('ACC023', 'Barras, tubos y perfiles'), ('ACC024', 'Barras, tubos y perfiles'),
  ('ACC020', 'Barras, tubos y perfiles'), ('ACC021', 'Barras, tubos y perfiles'),
  ('ACC016', 'Barras, tubos y perfiles'),

  ('ACC032', 'Soportes y sujetadores'), ('ACC033', 'Soportes y sujetadores'),
  ('ACC034', 'Soportes y sujetadores'), ('ACC031', 'Soportes y sujetadores'),
  ('ACC035', 'Soportes y sujetadores'), ('ACC036', 'Soportes y sujetadores'),

  ('ACC037', 'Manijas y cerraduras'), ('ACC049', 'Manijas y cerraduras'),
  ('ACC038', 'Manijas y cerraduras'), ('ACC039', 'Manijas y cerraduras'),
  ('ACC008', 'Manijas y cerraduras'),

  ('ACC051', 'Herramientas'), ('ACC052', 'Herramientas'), ('ACC053', 'Herramientas'),
  ('ACC054', 'Herramientas'), ('ACC055', 'Herramientas'), ('ACC056', 'Herramientas'),

  ('PEG002', 'Adhesivos'), ('PEG003', 'Adhesivos'), ('PEG004', 'Adhesivos'), ('PEG005', 'Adhesivos'),
  ('PEG006', 'Adhesivos'), ('PEG007', 'Adhesivos'), ('PEG008', 'Adhesivos'), ('PEG009', 'Adhesivos'),
  ('PEG010', 'Adhesivos'), ('PEG011', 'Adhesivos'), ('PEG012', 'Adhesivos'), ('PEG013', 'Adhesivos'),
  ('PEG014', 'Adhesivos'), ('PEG015', 'Adhesivos'), ('PEG016', 'Adhesivos'), ('PEG017', 'Adhesivos'),
  ('PEG018', 'Adhesivos'), ('PEG019', 'Adhesivos')
) as v (codigo, categoria)
join public.categorias_accesorio c on c.nombre = v.categoria
on conflict (codigo_odoo) do nothing;
