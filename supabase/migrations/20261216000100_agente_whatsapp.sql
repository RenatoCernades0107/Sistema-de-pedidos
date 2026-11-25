-- El área de pruebas del agente de ventas de WhatsApp (`/agente-whatsapp`).
--
-- 1. La base de conocimiento del agente: los archivos que Administración le sube
--    (catálogos, fichas técnicas, fotos) y sus fragmentos de texto, cada uno con
--    su vector para la búsqueda semántica (pgvector) y su `tsvector` en español
--    para la búsqueda por palabras. La búsqueda combina las dos (RRF): si un
--    fragmento no tiene vector, o el modelo de embeddings no responde, la de
--    palabras sigue funcionando.
-- 2. Las conversaciones de prueba, para volver a leerlas y ver por qué el agente
--    respondió lo que respondió.
--
-- Todo es solo de Administración (`es_admin()`), como la vista. Los precios, las
-- cuentas bancarias y la dirección no se copian aquí: el agente los lee de donde
-- ya viven (catálogo + Odoo, `cuentas_bancarias`, `configuracion.empresa`).
--
-- Los vectores son de 1536 dimensiones. Si se cambia de modelo de embeddings a
-- uno de otro tamaño, hace falta otra migración (y reindexar); la app pide
-- siempre 1536 (`DIMENSIONES_EMBEDDING` en lib/agente-whatsapp/config.ts).

create extension if not exists vector with schema extensions;

/* ── Documentos ─────────────────────────────────────────────────────────────── */

create table public.agente_documentos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (btrim(nombre) <> '' and length(nombre) <= 200),
  tipo          text not null check (tipo in ('catalogo', 'ficha_tecnica', 'foto', 'otro')),
  mime          text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  -- `<id>/<archivo>` en el bucket `agente_conocimiento`.
  ruta          text not null unique,
  tamano        integer not null check (tamano > 0),
  -- Lo que es, en palabras: para una foto es lo que se indexa (la genera el
  -- modelo y Administración la corrige); para un PDF, una nota opcional.
  descripcion   text not null default '' check (length(descripcion) <= 4000),
  estado        text not null default 'procesando' check (estado in ('procesando', 'listo', 'error')),
  error         text,
  -- Si el agente puede mandárselo al cliente tal cual (la foto, el catálogo en PDF).
  enviable      boolean not null default true,
  paginas       integer,
  creado_por    uuid not null default auth.uid() references public.usuarios (id),
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.agente_documentos is
  'Archivos de la base de conocimiento del agente de WhatsApp (lib/agente-whatsapp/conocimiento.ts).';

create table public.agente_fragmentos (
  id               uuid primary key default gen_random_uuid(),
  documento_id     uuid not null references public.agente_documentos (id) on delete cascade,
  orden            integer not null,
  pagina           integer,
  contenido        text not null check (btrim(contenido) <> ''),
  embedding        extensions.vector(1536),
  -- Con qué modelo se calculó `embedding`: solo se comparan vectores del mismo.
  modelo_embedding text,
  tsv              tsvector generated always as (to_tsvector('spanish', contenido)) stored,
  unique (documento_id, orden),
  check ((embedding is null) = (modelo_embedding is null))
);

create index agente_fragmentos_embedding_idx on public.agente_fragmentos
  using hnsw (embedding extensions.vector_cosine_ops);
create index agente_fragmentos_tsv_idx on public.agente_fragmentos using gin (tsv);
create index agente_fragmentos_documento_idx on public.agente_fragmentos (documento_id);

alter table public.agente_documentos enable row level security;
alter table public.agente_fragmentos enable row level security;

create policy agente_documentos_admin on public.agente_documentos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy agente_fragmentos_admin on public.agente_fragmentos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

/*
 * Búsqueda híbrida: los `p_limite` fragmentos más parecidos a la consulta, de
 * documentos listos. Junta dos listas por Reciprocal Rank Fusion (k = 60):
 *   - por vector (coseno), solo entre fragmentos indexados con `p_modelo`;
 *   - por palabras en español, con las palabras unidas por OR (una pregunta de
 *     WhatsApp trae muchas palabras que no están en el catálogo).
 * Sin `p_embedding`, solo la de palabras. Security invoker: respeta RLS.
 */
create function public.buscar_fragmentos_agente(
  p_texto     text,
  p_embedding extensions.vector(1536) default null,
  p_modelo    text default null,
  p_limite    integer default 6
)
returns table (
  fragmento_id     uuid,
  documento_id     uuid,
  documento_nombre text,
  documento_tipo   text,
  documento_enviable boolean,
  pagina           integer,
  contenido        text,
  puntaje          double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with consulta as (
    select nullif(replace(plainto_tsquery('spanish', coalesce(p_texto, ''))::text, '&', '|'), '')::tsquery as q
  ),
  por_vector as (
    select f.id, row_number() over (order by f.embedding <=> p_embedding) as r
    from public.agente_fragmentos f
    join public.agente_documentos d on d.id = f.documento_id and d.estado = 'listo'
    where p_embedding is not null
      and f.embedding is not null
      and f.modelo_embedding = p_modelo
    order by f.embedding <=> p_embedding
    limit 40
  ),
  por_texto as (
    select f.id, row_number() over (order by ts_rank_cd(f.tsv, c.q) desc) as r
    from public.agente_fragmentos f
    join public.agente_documentos d on d.id = f.documento_id and d.estado = 'listo'
    cross join consulta c
    where c.q is not null and f.tsv @@ c.q
    order by ts_rank_cd(f.tsv, c.q) desc
    limit 40
  ),
  fusion as (
    select coalesce(v.id, t.id) as id,
           coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + t.r), 0) as puntaje
    from por_vector v
    full outer join por_texto t on t.id = v.id
  )
  select f.id, d.id, d.nombre, d.tipo, d.enviable, f.pagina, f.contenido, fu.puntaje::double precision
  from fusion fu
  join public.agente_fragmentos f on f.id = fu.id
  join public.agente_documentos d on d.id = f.documento_id
  order by fu.puntaje desc, f.orden
  limit greatest(1, least(coalesce(p_limite, 6), 20));
$$;

/* ── Archivos ───────────────────────────────────────────────────────────────── */

-- El navegador sube el archivo directo aquí (una Server Action no pasa de 1 MB)
-- y la ruta de procesamiento lo lee con la sesión de quien lo subió.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agente_conocimiento', 'agente_conocimiento', false, 20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy agente_conocimiento_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'agente_conocimiento' and public.es_admin());

-- Solo en la carpeta de un documento que ya exista (`<id>/<archivo>`).
create policy agente_conocimiento_subida on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'agente_conocimiento'
    and public.es_admin()
    and exists (select 1 from public.agente_documentos d where d.ruta = name)
  );

create policy agente_conocimiento_borrado on storage.objects
  for delete to authenticated
  using (bucket_id = 'agente_conocimiento' and public.es_admin());

/* ── Conversaciones de prueba ───────────────────────────────────────────────── */

create table public.agente_pruebas (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null default 'Prueba' check (length(titulo) <= 120),
  -- El anuncio de Meta del que "viene" el cliente simulado (lib/agente-whatsapp/tipos.ts, Anuncio). Null si no.
  anuncio     jsonb check (anuncio is null or jsonb_typeof(anuncio) = 'object'),
  creado_por  uuid not null default auth.uid() references public.usuarios (id),
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.agente_pruebas_mensajes (
  id         uuid primary key default gen_random_uuid(),
  prueba_id  uuid not null references public.agente_pruebas (id) on delete cascade,
  rol        text not null check (rol in ('cliente', 'agente')),
  contenido  text not null default '',
  -- Lo que el agente adjuntó (fotos, PDF): lista de { documentoId, nombre, mime }.
  adjuntos   jsonb check (adjuntos is null or jsonb_typeof(adjuntos) = 'array'),
  -- Qué herramientas usó para responder y qué le devolvieron, resumido.
  traza      jsonb check (traza is null or jsonb_typeof(traza) = 'array'),
  derivado   boolean not null default false,
  creado_en  timestamptz not null default now()
);

create index agente_pruebas_mensajes_prueba_idx on public.agente_pruebas_mensajes (prueba_id, creado_en);

alter table public.agente_pruebas enable row level security;
alter table public.agente_pruebas_mensajes enable row level security;

create policy agente_pruebas_admin on public.agente_pruebas
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy agente_pruebas_mensajes_admin on public.agente_pruebas_mensajes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
