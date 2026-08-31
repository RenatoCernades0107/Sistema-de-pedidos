-- Qué admite el bucket de adjuntos.
--
-- La app repite estas dos reglas en `lib/adjuntos.ts` para poder avisar antes de
-- gastar la subida, pero quien tiene que cortar es Storage: el archivo viaja del
-- navegador al bucket sin pasar por el servidor de Next, así que una validación
-- que solo viva en el cliente no es una validación.
--
-- 10 MiB cubre un plano exportado y una foto de celular. PDF e imágenes y nada
-- más: el bucket no es sitio para ejecutables ni para archivos que después nadie
-- sabe con qué abrir.

update storage.buckets
set
  file_size_limit    = 10485760,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
where id = 'adjuntos';
