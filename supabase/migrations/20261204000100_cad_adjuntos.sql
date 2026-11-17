-- Archivos adjuntos (imágenes y PDF) en el chat de diseños.
--
-- La persona puede adjuntar fotos, bocetos o planos a un mensaje para que el
-- asistente los lea. El archivo vive en el bucket privado `cad_adjuntos`, en la
-- carpeta del diseño (`<diseno_id>/<uuid>.<ext>`), y el mensaje guarda la lista
-- de lo que adjuntó: así se vuelve a pintar al abrir el diseño y se le reenvía
-- al asistente en los turnos siguientes.
--
-- Lo sube el navegador directo a Storage (un plano escaneado no cabe en el
-- cuerpo de una petición a Vercel) y lo lee la ruta del chat con la sesión de
-- quien escribe. Los permisos son los mismos que los de `cad_mensajes`:
-- cualquiera con rol (`auth_rol()` no nulo).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cad_adjuntos', 'cad_adjuntos', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- El diseño de una ruta del bucket, o null si la ruta no tiene la forma.
create function public.diseno_de_ruta_adjunto(p_ruta text)
returns uuid
language plpgsql
immutable
as $$
declare
  partes text[] := string_to_array(p_ruta, '/');
begin
  if array_length(partes, 1) <> 2 or btrim(partes[2]) = '' then
    return null;
  end if;
  return partes[1]::uuid;
exception when invalid_text_representation then
  return null;
end $$;

create policy cad_adjuntos_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'cad_adjuntos' and public.auth_rol() is not null);

-- Solo dentro de la carpeta de un diseño que exista.
create policy cad_adjuntos_subida on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cad_adjuntos'
    and public.auth_rol() is not null
    and exists (select 1 from public.cad_disenos d where d.id = public.diseno_de_ruta_adjunto(name))
  );

alter table public.cad_mensajes
  add column adjuntos jsonb
    check (adjuntos is null or jsonb_typeof(adjuntos) = 'array');

comment on column public.cad_mensajes.adjuntos is
  'Archivos adjuntos al mensaje (lista de AdjuntoCad, lib/cad/adjuntos.ts: ruta en el bucket cad_adjuntos, nombre, mime, tamaño). Null si ninguno.';
