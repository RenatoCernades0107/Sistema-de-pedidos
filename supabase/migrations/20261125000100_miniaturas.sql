-- Miniaturas PNG de los modelos 3D.
--
-- El modelo 3D no se guarda (se regenera con el motor), así que sin una foto no
-- hay nada que mostrar en una tarjeta sin llamar al motor. Las fotos las saca el
-- navegador del GLB que ya generó (`lib/cad/miniatura.ts`) y se guardan aquí:
--   · `productos/<codigo>-<marca>.png` → `pt_productos.miniatura_path` (el catálogo).
--   · `disenos/<version_id>.png`       → `cad_diseno_versiones.miniatura_path`.
--
-- Bucket público: son renders de productos, sin datos de clientes, y la ruta de
-- un diseño lleva el uuid de su versión. Así se sirven sin firmar URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('miniaturas', 'miniaturas', true, 1048576, array['image/png'])
on conflict (id) do nothing;

-- Escriben quienes usan el CAD (Administración), igual que `cad_*_admin`.
create policy miniaturas_storage_escritura on storage.objects
  for all to authenticated
  using (bucket_id = 'miniaturas' and public.es_admin())
  with check (bucket_id = 'miniaturas' and public.es_admin());

-- Aparte de `imagen_url`, que es la foto de referencia del producto (de la web).
alter table public.pt_productos
  add column miniatura_path text check (miniatura_path is null or miniatura_path ~ '^productos/[A-Z0-9-]{1,20}-[0-9]+\.png$');

comment on column public.pt_productos.miniatura_path is
  'La foto del modelo 3D del producto en su primera medida estándar, en el bucket `miniaturas`.';

alter table public.cad_diseno_versiones
  add column miniatura_path text check (miniatura_path is null or miniatura_path ~ '^disenos/[0-9a-f-]{36}\.png$');

comment on column public.cad_diseno_versiones.miniatura_path is
  'La foto del modelo 3D de esta versión, en el bucket `miniaturas`. Null mientras nadie la haya abierto.';

-- Una versión no se corrige (se guarda otra), pero su foto llega después de
-- guardarla: solo esta columna se puede cambiar.
grant update (miniatura_path) on public.cad_diseno_versiones to authenticated;
