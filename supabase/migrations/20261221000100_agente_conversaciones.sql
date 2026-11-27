-- Conversaciones del agente de WhatsApp: quién las atiende y qué adjunta el cliente.
--
-- 1. Cada conversación tiene un estado (`agente_pruebas.estado`):
--      agente            → el agente responde.
--      necesita_atencion → el agente no supo o no debía responder: calla y espera a
--                          un asesor. La vista /conversaciones la muestra arriba.
--      asesor            → ya respondió un humano; el agente sigue callado.
--      resuelta          → cerrada. Si el cliente vuelve a escribir, vuelve a `agente`.
--    Las transiciones las decide la app (lib/agente-whatsapp/estado.ts).
-- 2. Los mensajes pueden ser también de un asesor humano (`rol = 'asesor'`), con su autor.
-- 3. El cliente puede adjuntar fotos y PDF (bucket `agente_adjuntos`): van en
--    `adjuntos` del mensaje del cliente, como ya iban los archivos que manda el agente.
-- 4. Ventas atiende conversaciones: lee y responde. La base de conocimiento y los
--    ajustes del agente siguen siendo de Administración; Ventas solo puede leer los
--    documentos, para ver lo que el agente le mandó al cliente.

/* ── Quién atiende ───────────────────────────────────────────────────────────── */

create function public.atiende_conversaciones()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_rol() in ('administracion', 'ventas'), false)
$$;

/* ── Estado de la conversación ───────────────────────────────────────────────── */

alter table public.agente_pruebas
  add column estado text not null default 'agente'
    check (estado in ('agente', 'necesita_atencion', 'asesor', 'resuelta')),
  -- Por qué el agente la pasó a un asesor ("cotizar corte", "no sé la respuesta"…).
  add column motivo_atencion text check (motivo_atencion is null or length(motivo_atencion) <= 300),
  -- Desde cuándo espera a un humano: para ordenar y decir "hace 12 min".
  add column atencion_desde timestamptz,
  -- Quién la atendió por última vez (respondió, la devolvió o la cerró).
  add column atendida_por uuid references public.usuarios (id);

create index agente_pruebas_estado_idx on public.agente_pruebas (estado, actualizado_en desc);

comment on column public.agente_pruebas.estado is
  'agente | necesita_atencion | asesor | resuelta (lib/agente-whatsapp/estado.ts).';

/* ── Mensajes de asesores ────────────────────────────────────────────────────── */

alter table public.agente_pruebas_mensajes drop constraint agente_pruebas_mensajes_rol_check;
alter table public.agente_pruebas_mensajes
  add constraint agente_pruebas_mensajes_rol_check check (rol in ('cliente', 'agente', 'asesor')),
  add column autor_id uuid default auth.uid() references public.usuarios (id);

comment on column public.agente_pruebas_mensajes.adjuntos is
  'Del agente: documentos que envió ({ documentoId, nombre, mime, tipo, texto }). '
  'Del cliente: archivos que adjuntó ({ ruta, nombre, mime, tamano }, bucket agente_adjuntos).';

/* ── Permisos: Ventas atiende ────────────────────────────────────────────────── */

drop policy agente_pruebas_admin on public.agente_pruebas;
drop policy agente_pruebas_mensajes_admin on public.agente_pruebas_mensajes;

create policy agente_pruebas_lectura on public.agente_pruebas
  for select to authenticated using (public.atiende_conversaciones());
-- Las conversaciones de prueba las abre el área de pruebas (Administración).
create policy agente_pruebas_alta on public.agente_pruebas
  for insert to authenticated with check (public.es_admin());
create policy agente_pruebas_cambio on public.agente_pruebas
  for update to authenticated
  using (public.atiende_conversaciones()) with check (public.atiende_conversaciones());
create policy agente_pruebas_borrado on public.agente_pruebas
  for delete to authenticated using (public.es_admin());

create policy agente_pruebas_mensajes_lectura on public.agente_pruebas_mensajes
  for select to authenticated using (public.atiende_conversaciones());
-- Ventas solo escribe como asesor; los mensajes del cliente y del agente los
-- escribe el área de pruebas, que es de Administración.
create policy agente_pruebas_mensajes_alta on public.agente_pruebas_mensajes
  for insert to authenticated
  with check (public.es_admin() or (public.es_ventas() and rol = 'asesor'));
create policy agente_pruebas_mensajes_borrado on public.agente_pruebas_mensajes
  for delete to authenticated using (public.es_admin());

-- Ventas ve qué documentos mandó el agente (nombre, tipo) y puede abrirlos.
create policy agente_documentos_lectura_ventas on public.agente_documentos
  for select to authenticated using (public.es_ventas());
create policy agente_conocimiento_lectura_ventas on storage.objects
  for select to authenticated
  using (bucket_id = 'agente_conocimiento' and public.es_ventas());

/* ── Adjuntos del cliente ────────────────────────────────────────────────────── */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agente_adjuntos', 'agente_adjuntos', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- La conversación de una ruta del bucket (`<prueba_id>/<archivo>`), o null si no tiene la forma.
create function public.prueba_de_ruta_adjunto(p_ruta text)
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

create policy agente_adjuntos_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'agente_adjuntos' and public.atiende_conversaciones());

-- Solo en la carpeta de una conversación que exista. Hoy sube el área de pruebas
-- (Administración); el webhook de WhatsApp subirá con su propia función.
create policy agente_adjuntos_subida on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'agente_adjuntos'
    and public.es_admin()
    and exists (select 1 from public.agente_pruebas p where p.id = public.prueba_de_ruta_adjunto(name))
  );
