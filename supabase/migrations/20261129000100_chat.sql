-- El chat del equipo: canal general, canales, mensajes directos y el chat de
-- cada pedido, todo en un solo sistema.
--
--   conversaciones         → una sala. `general` (una sola, de todos), `canal` (los
--                            crea Administración y elige quién está), `directo`
--                            (entre dos personas) y `pedido` (una por pedido, de todos).
--   conversacion_miembros  → quién está en un canal o en un directo. La general y
--                            las de pedido no tienen lista: son de los tres roles.
--   mensajes               → lo que se escribe. Nadie edita ni borra.
--   mensaje_adjuntos       → fotos, videos y PDF de un mensaje (bucket `chat`).
--   mensaje_lecturas       → quién vio cada mensaje y cuándo (el doble check azul).
--
-- Las referencias (@cliente, @pedido, @plancha, @diseño, @usuario) viajan con el
-- mensaje en `referencias`: el texto lleva fichas `@r1`, `@r2`… y la lista guarda
-- una foto de cada entidad (tipo, id, etiqueta). Así el mensaje se sigue leyendo
-- igual aunque el pedido cambie de nombre o el diseño se borre. La forma la valida
-- la app (`lib/chat/tipos.ts`); aquí solo lo indispensable para que nadie meta
-- basura que rompa la lectura.
--
-- Reemplaza a `pedido_mensajes` (20261128000100): sus mensajes se copian al final.

-- ── 1. Conversaciones ───────────────────────────────────────────────────────

create type public.tipo_conversacion as enum ('general', 'canal', 'directo', 'pedido');

create table public.conversaciones (
  id                uuid        primary key default gen_random_uuid(),
  tipo              public.tipo_conversacion not null,
  nombre            text        check (nombre is null or (btrim(nombre) <> '' and length(nombre) <= 60)),
  descripcion       text        check (descripcion is null or length(descripcion) <= 280),
  pedido_id         uuid        unique references public.pedidos (id) on delete cascade,
  -- Los dos ids del directo ordenados y unidos por ':'. Que sea único es lo que
  -- impide abrir dos directos entre las mismas dos personas.
  directo_clave     text        unique,
  creado_por        uuid        references public.usuarios (id) on delete set null default auth.uid(),
  creado_en         timestamptz not null default now(),
  ultimo_mensaje_en timestamptz,
  constraint conversaciones_pedido_check  check ((tipo = 'pedido')  = (pedido_id is not null)),
  constraint conversaciones_directo_check check ((tipo = 'directo') = (directo_clave is not null)),
  constraint conversaciones_canal_check   check (tipo <> 'canal' or nombre is not null)
);

-- Una sola sala general.
create unique index conversaciones_una_general on public.conversaciones ((true)) where tipo = 'general';
create index conversaciones_ultimo_idx on public.conversaciones (ultimo_mensaje_en desc nulls last);

comment on table public.conversaciones is
  'Salas del chat: general, canales (los crea Administración), directos y una por pedido.';

insert into public.conversaciones (tipo, nombre, descripcion, creado_por)
values ('general', 'General', 'Todo el equipo.', null);

create table public.conversacion_miembros (
  conversacion_id uuid        not null references public.conversaciones (id) on delete cascade,
  usuario_id      uuid        not null references public.usuarios (id) on delete cascade,
  agregado_por    uuid        references public.usuarios (id) on delete set null,
  agregado_en     timestamptz not null default now(),
  primary key (conversacion_id, usuario_id)
);

create index conversacion_miembros_usuario_idx on public.conversacion_miembros (usuario_id);

comment on table public.conversacion_miembros is
  'Quién está en un canal o en un directo. La general y las de pedido no la usan: son de todos.';

-- ¿Puede `p_usuario` leer y escribir en la conversación? La general y las de
-- pedido, cualquiera con rol activo; un canal o un directo, solo sus miembros.
-- Administración ve además todos los canales (los administra), pero no los
-- directos de otros.
create function public.puede_ver_conversacion_de(p_conversacion_id uuid, p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.conversaciones c
      join public.usuarios u on u.id = p_usuario and u.activo
     where c.id = p_conversacion_id
       and (
         c.tipo in ('general', 'pedido')
         or (c.tipo = 'canal' and u.rol = 'administracion')
         or exists (
           select 1 from public.conversacion_miembros m
            where m.conversacion_id = c.id and m.usuario_id = p_usuario
         )
       )
  )
$$;

create function public.puede_ver_conversacion(p_conversacion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and public.puede_ver_conversacion_de(p_conversacion_id, auth.uid())
$$;

revoke execute on function public.puede_ver_conversacion_de(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.puede_ver_conversacion(uuid) from public, anon;
grant  execute on function public.puede_ver_conversacion(uuid) to authenticated;

-- ── 2. Mensajes ─────────────────────────────────────────────────────────────

-- Lo mínimo de una referencia para que el mensaje se pueda pintar: alias `rN`,
-- un tipo conocido, un id y una etiqueta corta.
create function public.referencias_validas(p_refs jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_refs) = 'array'
     and jsonb_array_length(p_refs) <= 20
     and not exists (
       select 1
         from jsonb_array_elements(p_refs) r
        where jsonb_typeof(r) <> 'object'
           or coalesce(r ->> 'alias', '') !~ '^r[0-9]{1,2}$'
           or coalesce(r ->> 'tipo', '') not in ('cliente', 'pedido', 'plancha', 'diseno', 'usuario')
           or btrim(coalesce(r ->> 'id', '')) = ''
           or length(coalesce(r ->> 'id', '')) > 120
           or btrim(coalesce(r ->> 'etiqueta', '')) = ''
           or length(coalesce(r ->> 'etiqueta', '')) > 160
     )
$$;

create table public.mensajes (
  id              uuid        primary key default gen_random_uuid(),
  conversacion_id uuid        not null references public.conversaciones (id) on delete cascade,
  autor_id        uuid        not null default auth.uid() references public.usuarios (id) on delete cascade,
  -- El nombre se copia al escribir: `usuarios` solo deja leer el perfil propio, y
  -- un chat tiene que decir quién habló aunque la cuenta se desactive después.
  autor_nombre    text        not null default '',
  autor_rol       public.rol,
  -- Vacío solo si el mensaje lleva adjuntos (lo controla `enviar_mensaje`).
  texto           text        not null default '' check (length(texto) <= 4000),
  referencias     jsonb       not null default '[]' check (public.referencias_validas(referencias)),
  creado_en       timestamptz not null default now()
);

create index mensajes_conversacion_idx on public.mensajes (conversacion_id, creado_en);
-- Para encontrar "me mencionaron" sin recorrer todo.
create index mensajes_referencias_idx on public.mensajes using gin (referencias jsonb_path_ops);

comment on table public.mensajes is
  'Mensajes del chat. Se escriben por enviar_mensaje(); nadie edita ni borra.';
comment on column public.mensajes.referencias is
  'Fichas @rN del texto: [{alias, tipo, id, etiqueta, detalle?, contexto?}] (lib/chat/tipos.ts).';

-- Quién escribe lo decide la sesión, no el navegador. Sin sesión (una migración,
-- la clave de servicio) se respeta lo que viene: así se copian los mensajes viejos.
create function public.firmar_mensaje()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.autor_id := auth.uid();
    new.creado_en := now();
    select u.nombre, u.rol into new.autor_nombre, new.autor_rol
      from public.usuarios u
     where u.id = new.autor_id;
    new.autor_nombre := coalesce(new.autor_nombre, '');
  end if;
  new.texto := btrim(new.texto);
  return new;
end $$;

revoke execute on function public.firmar_mensaje() from public, anon, authenticated;

create trigger mensajes_firmar
  before insert on public.mensajes
  for each row execute function public.firmar_mensaje();

-- ── 3. Adjuntos ─────────────────────────────────────────────────────────────

-- Lo que el chat acepta. Las fotos del iPhone llegan como HEIC y los videos como
-- QuickTime; se guardan tal cual y el navegador que no los muestre ofrece bajarlos.
create function public.mime_chat_permitido(p_mime text)
returns boolean
language sql
immutable
as $$
  select p_mime in (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'application/pdf'
  )
$$;

create table public.mensaje_adjuntos (
  id              uuid        primary key default gen_random_uuid(),
  mensaje_id      uuid        not null references public.mensajes (id) on delete cascade,
  conversacion_id uuid        not null references public.conversaciones (id) on delete cascade,
  storage_path    text        not null unique,
  nombre          text        not null check (btrim(nombre) <> '' and length(nombre) <= 200),
  mime            text        not null check (public.mime_chat_permitido(mime)),
  tamano          bigint      not null check (tamano > 0 and tamano <= 52428800),
  ancho           int         check (ancho is null or ancho > 0),
  alto            int         check (alto is null or alto > 0),
  duracion_s      numeric(8, 2) check (duracion_s is null or duracion_s >= 0),
  posicion        smallint    not null default 0,
  creado_en       timestamptz not null default now()
);

create index mensaje_adjuntos_mensaje_idx on public.mensaje_adjuntos (mensaje_id, posicion);
create index mensaje_adjuntos_conversacion_idx on public.mensaje_adjuntos (conversacion_id, creado_en);

comment on table public.mensaje_adjuntos is
  'Fotos, videos y PDF de un mensaje. El archivo vive en el bucket privado `chat`.';

-- Ruta: conversaciones/<conversacion_id>/<uuid>-<nombre>. Privado: se lee con URL firmada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat', 'chat', false, 52428800,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- La conversación de una ruta del bucket, o null si la ruta no tiene la forma.
create function public.conversacion_de_ruta(p_ruta text)
returns uuid
language plpgsql
immutable
as $$
declare
  partes text[] := string_to_array(p_ruta, '/');
begin
  if array_length(partes, 1) <> 3 or partes[1] <> 'conversaciones' or btrim(partes[3]) = '' then
    return null;
  end if;
  return partes[2]::uuid;
exception when invalid_text_representation then
  return null;
end $$;

create policy chat_storage_lectura on storage.objects
  for select to authenticated
  using (bucket_id = 'chat' and public.puede_ver_conversacion(public.conversacion_de_ruta(name)));

create policy chat_storage_subida on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat' and public.puede_ver_conversacion(public.conversacion_de_ruta(name)));

-- Solo se borra lo propio que no llegó a enviarse (la subida quedó huérfana
-- porque el mensaje falló). Lo enviado no se borra: el chat no se edita.
create policy chat_storage_borrar_huerfano on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat'
    and owner = auth.uid()
    and not exists (select 1 from public.mensaje_adjuntos a where a.storage_path = name)
  );

-- ── 4. Lecturas ─────────────────────────────────────────────────────────────

create table public.mensaje_lecturas (
  mensaje_id      uuid        not null references public.mensajes (id) on delete cascade,
  usuario_id      uuid        not null references public.usuarios (id) on delete cascade,
  conversacion_id uuid        not null references public.conversaciones (id) on delete cascade,
  leido_en        timestamptz not null default now(),
  primary key (mensaje_id, usuario_id)
);

create index mensaje_lecturas_conversacion_idx on public.mensaje_lecturas (conversacion_id, usuario_id);

comment on table public.mensaje_lecturas is
  'Quién vio cada mensaje y cuándo. Se escribe solo con marcar_leidos().';

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

alter table public.conversaciones        enable row level security;
alter table public.conversacion_miembros enable row level security;
alter table public.mensajes              enable row level security;
alter table public.mensaje_adjuntos      enable row level security;
alter table public.mensaje_lecturas      enable row level security;

create policy conversaciones_lectura on public.conversaciones
  for select to authenticated using (public.puede_ver_conversacion(id));

create policy conversacion_miembros_lectura on public.conversacion_miembros
  for select to authenticated using (public.puede_ver_conversacion(conversacion_id));

create policy mensajes_lectura on public.mensajes
  for select to authenticated using (public.puede_ver_conversacion(conversacion_id));

create policy mensaje_adjuntos_lectura on public.mensaje_adjuntos
  for select to authenticated using (public.puede_ver_conversacion(conversacion_id));

create policy mensaje_lecturas_lectura on public.mensaje_lecturas
  for select to authenticated using (public.puede_ver_conversacion(conversacion_id));

-- Todo lo que escribe pasa por las funciones de abajo, que validan y firman.
revoke all on public.conversaciones, public.conversacion_miembros, public.mensajes,
              public.mensaje_adjuntos, public.mensaje_lecturas
  from anon, authenticated;
grant select on public.conversaciones, public.conversacion_miembros, public.mensajes,
                public.mensaje_adjuntos, public.mensaje_lecturas
  to authenticated;

-- ── 6. Funciones del chat ───────────────────────────────────────────────────

-- El texto con cada `@rN` cambiado por `@etiqueta`, para los avisos y la lista.
create function public.texto_con_etiquetas(p_texto text, p_refs jsonb)
returns text
language plpgsql
immutable
as $$
declare
  r jsonb;
  t text := coalesce(p_texto, '');
begin
  for r in select * from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) loop
    if coalesce(r ->> 'alias', '') ~ '^r[0-9]{1,2}$' then
      t := regexp_replace(t, '@' || (r ->> 'alias') || '\M', '@' || coalesce(r ->> 'etiqueta', ''), 'g');
    end if;
  end loop;
  return t;
end $$;

-- Las personas activas, para elegir a quién mencionar o escribirle. `usuarios`
-- solo deja leer el perfil propio; esto expone lo justo: nombre, usuario y rol.
create function public.directorio_usuarios()
returns table (id uuid, nombre text, usuario text, rol public.rol)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.nombre, u.usuario, u.rol
    from public.usuarios u
   where public.auth_rol() is not null
     and u.activo
   order by u.nombre
$$;

-- Quién participa de una conversación y desde cuándo. "Desde" es lo que decide
-- si un mensaje era para esa persona: alguien que entró al canal después no
-- cuenta para el doble check de los mensajes de antes.
create function public.participantes_conversacion(p_conversacion_id uuid)
returns table (usuario_id uuid, nombre text, rol public.rol, desde timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.nombre, u.rol,
         case when c.tipo in ('general', 'pedido') then u.creado_en else m.agregado_en end
    from public.conversaciones c
    join public.usuarios u on u.activo
    left join public.conversacion_miembros m
      on m.conversacion_id = c.id and m.usuario_id = u.id
   where c.id = p_conversacion_id
     and public.puede_ver_conversacion(c.id)
     and (c.tipo in ('general', 'pedido') or m.usuario_id is not null)
   order by u.nombre
$$;

-- Envía un mensaje con sus adjuntos, todo o nada. Los archivos ya tienen que
-- estar subidos al bucket `chat` en la carpeta de la conversación.
--
-- p_adjuntos: [{ruta, nombre, mime, tamano, ancho?, alto?, duracion?}]
create function public.enviar_mensaje(
  p_conversacion_id uuid,
  p_texto           text,
  p_referencias     jsonb default '[]',
  p_adjuntos        jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_adj   jsonb := coalesce(p_adjuntos, '[]'::jsonb);
  a       jsonb;
  v_pos   smallint := 0;
  v_ruta  text;
  v_tam   bigint;
begin
  if auth.uid() is null or not public.puede_ver_conversacion(p_conversacion_id) then
    raise exception 'No tienes acceso a esta conversación' using errcode = '42501';
  end if;

  if jsonb_typeof(v_adj) <> 'array' or jsonb_array_length(v_adj) > 10 then
    raise exception 'Hasta 10 archivos por mensaje';
  end if;

  if v_texto = '' and jsonb_array_length(v_adj) = 0 then
    raise exception 'El mensaje está vacío';
  end if;

  insert into public.mensajes (conversacion_id, texto, referencias)
  values (p_conversacion_id, v_texto, coalesce(p_referencias, '[]'::jsonb))
  returning id into v_id;

  for a in select * from jsonb_array_elements(v_adj) loop
    v_ruta := a ->> 'ruta';
    if public.conversacion_de_ruta(v_ruta) is distinct from p_conversacion_id then
      raise exception 'El archivo % no es de esta conversación', coalesce(a ->> 'nombre', '');
    end if;

    -- El tamaño real lo dice Storage, no el navegador.
    select coalesce((o.metadata ->> 'size')::bigint, (a ->> 'tamano')::bigint)
      into v_tam
      from storage.objects o
     where o.bucket_id = 'chat' and o.name = v_ruta and o.owner = auth.uid();

    if not found then
      raise exception 'El archivo % no terminó de subirse', coalesce(a ->> 'nombre', '');
    end if;

    insert into public.mensaje_adjuntos (
      mensaje_id, conversacion_id, storage_path, nombre, mime, tamano,
      ancho, alto, duracion_s, posicion
    ) values (
      v_id, p_conversacion_id, v_ruta, left(btrim(a ->> 'nombre'), 200), a ->> 'mime', v_tam,
      nullif((a ->> 'ancho')::int, 0), nullif((a ->> 'alto')::int, 0),
      (a ->> 'duracion')::numeric, v_pos
    );
    v_pos := v_pos + 1;
  end loop;

  update public.conversaciones set ultimo_mensaje_en = now() where id = p_conversacion_id;

  return v_id;
end $$;

-- Marca como vistos los mensajes ajenos de la conversación hasta `p_hasta`.
-- Devuelve cuántos marcó.
create function public.marcar_leidos(p_conversacion_id uuid, p_hasta timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if auth.uid() is null or not public.puede_ver_conversacion(p_conversacion_id) then
    return 0;
  end if;

  insert into public.mensaje_lecturas (mensaje_id, usuario_id, conversacion_id)
  select m.id, auth.uid(), m.conversacion_id
    from public.mensajes m
   where m.conversacion_id = p_conversacion_id
     and m.creado_en <= coalesce(p_hasta, now())
     and m.autor_id <> auth.uid()
     and not exists (
       select 1 from public.mensaje_lecturas l
        where l.mensaje_id = m.id and l.usuario_id = auth.uid()
     )
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- Las conversaciones de la persona, para la lista del chat. Las de pedido salen
-- solo si escribió en ellas o la mencionaron: hay una por pedido y llenarían todo.
create function public.resumen_conversaciones()
returns table (
  id                 uuid,
  tipo               public.tipo_conversacion,
  nombre             text,
  descripcion        text,
  pedido_id          uuid,
  pedido_codigo      text,
  otro_usuario_id    uuid,
  otro_usuario_rol   public.rol,
  miembros           int,
  ultimo_mensaje_en  timestamptz,
  ultimo_texto       text,
  ultimo_autor       text,
  ultimo_autor_id    uuid,
  ultimo_adjuntos    int,
  sin_leer           int,
  menciones_sin_leer int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with yo as (
    select u.id, u.creado_en from public.usuarios u where u.id = auth.uid() and u.activo
  ),
  mias as (
    select c.*
      from public.conversaciones c, yo
     where public.puede_ver_conversacion_de(c.id, yo.id)
       and (
         c.tipo <> 'pedido'
         or exists (select 1 from public.mensajes m where m.conversacion_id = c.id and m.autor_id = yo.id)
         or exists (
           select 1 from public.mensajes m
            where m.conversacion_id = c.id
              and m.referencias @> jsonb_build_array(jsonb_build_object('tipo', 'usuario', 'id', yo.id::text))
         )
       )
  )
  select
    c.id, c.tipo,
    case when c.tipo = 'directo' then otro.nombre
         when c.tipo = 'pedido' then 'Pedido ' || p.codigo
         else c.nombre end,
    c.descripcion,
    c.pedido_id, p.codigo,
    otro.id, otro.rol,
    (select count(*)::int from public.conversacion_miembros m where m.conversacion_id = c.id),
    c.ultimo_mensaje_en,
    public.texto_con_etiquetas(ult.texto, ult.referencias),
    ult.autor_nombre, ult.autor_id,
    (select count(*)::int from public.mensaje_adjuntos a where a.mensaje_id = ult.id),
    (select count(*)::int
       from public.mensajes m
      where m.conversacion_id = c.id
        and m.autor_id <> yo.id
        and m.creado_en >= coalesce(miembro.agregado_en, yo.creado_en)
        and not exists (select 1 from public.mensaje_lecturas l where l.mensaje_id = m.id and l.usuario_id = yo.id)),
    (select count(*)::int
       from public.mensajes m
      where m.conversacion_id = c.id
        and m.autor_id <> yo.id
        and m.referencias @> jsonb_build_array(jsonb_build_object('tipo', 'usuario', 'id', yo.id::text))
        and not exists (select 1 from public.mensaje_lecturas l where l.mensaje_id = m.id and l.usuario_id = yo.id))
  from mias c
  cross join yo
  left join public.pedidos p on p.id = c.pedido_id
  left join public.conversacion_miembros miembro
    on miembro.conversacion_id = c.id and miembro.usuario_id = yo.id and c.tipo in ('canal', 'directo')
  left join lateral (
    select u.id, u.nombre, u.rol
      from public.conversacion_miembros m
      join public.usuarios u on u.id = m.usuario_id
     where c.tipo = 'directo' and m.conversacion_id = c.id and m.usuario_id <> yo.id
     limit 1
  ) otro on true
  left join lateral (
    select m.id, m.texto, m.referencias, m.autor_nombre, m.autor_id
      from public.mensajes m
     where m.conversacion_id = c.id
     order by m.creado_en desc
     limit 1
  ) ult on true
  order by (c.tipo = 'general') desc, c.ultimo_mensaje_en desc nulls last, c.creado_en desc
$$;

-- El directo con otra persona: lo devuelve si ya existe, si no lo crea.
create function public.abrir_directo(p_usuario_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_yo    uuid := auth.uid();
  v_clave text;
  v_id    uuid;
begin
  if v_yo is null or public.auth_rol() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if p_usuario_id is null or p_usuario_id = v_yo then
    raise exception 'Elige a otra persona';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_usuario_id and u.activo) then
    raise exception 'Esa persona no está activa';
  end if;

  v_clave := least(v_yo::text, p_usuario_id::text) || ':' || greatest(v_yo::text, p_usuario_id::text);

  insert into public.conversaciones (tipo, directo_clave, creado_por)
  values ('directo', v_clave, v_yo)
  on conflict (directo_clave) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.conversaciones c where c.directo_clave = v_clave;
  end if;

  insert into public.conversacion_miembros (conversacion_id, usuario_id, agregado_por)
  values (v_id, v_yo, v_yo), (v_id, p_usuario_id, v_yo)
  on conflict do nothing;

  return v_id;
end $$;

-- La conversación de un pedido: la devuelve o la crea.
create function public.conversacion_de_pedido(p_pedido_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if public.auth_rol() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pedidos p where p.id = p_pedido_id) then
    raise exception 'El pedido no existe';
  end if;

  insert into public.conversaciones (tipo, pedido_id)
  values ('pedido', p_pedido_id)
  on conflict (pedido_id) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.conversaciones c where c.pedido_id = p_pedido_id;
  end if;
  return v_id;
end $$;

-- ── Canales (solo Administración los crea y decide quién está) ──────────────

create function public.crear_canal(p_nombre text, p_descripcion text, p_miembros uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo Administración crea canales' using errcode = '42501';
  end if;

  insert into public.conversaciones (tipo, nombre, descripcion, creado_por)
  values ('canal', btrim(p_nombre), nullif(btrim(coalesce(p_descripcion, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.conversacion_miembros (conversacion_id, usuario_id, agregado_por)
  select v_id, u.id, auth.uid()
    from public.usuarios u
   where u.activo and (u.id = auth.uid() or u.id = any (coalesce(p_miembros, '{}')))
  on conflict do nothing;

  return v_id;
end $$;

create function public.editar_canal(p_conversacion_id uuid, p_nombre text, p_descripcion text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo Administración edita canales' using errcode = '42501';
  end if;
  update public.conversaciones
     set nombre = btrim(p_nombre),
         descripcion = nullif(btrim(coalesce(p_descripcion, '')), '')
   where id = p_conversacion_id and tipo = 'canal';
  if not found then
    raise exception 'El canal no existe';
  end if;
end $$;

create function public.agregar_miembros(p_conversacion_id uuid, p_usuarios uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if not public.es_admin() then
    raise exception 'Solo Administración agrega miembros' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversaciones where id = p_conversacion_id and tipo = 'canal') then
    raise exception 'El canal no existe';
  end if;

  insert into public.conversacion_miembros (conversacion_id, usuario_id, agregado_por)
  select p_conversacion_id, u.id, auth.uid()
    from public.usuarios u
   where u.activo and u.id = any (coalesce(p_usuarios, '{}'))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Administración saca a cualquiera; cada persona puede salirse sola.
create function public.quitar_miembro(p_conversacion_id uuid, p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.es_admin() or (p_usuario_id = auth.uid() and public.auth_rol() is not null)) then
    raise exception 'Solo Administración saca a otros del canal' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversaciones where id = p_conversacion_id and tipo = 'canal') then
    raise exception 'El canal no existe';
  end if;
  delete from public.conversacion_miembros
   where conversacion_id = p_conversacion_id and usuario_id = p_usuario_id;
end $$;

create function public.eliminar_canal(p_conversacion_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo Administración elimina canales' using errcode = '42501';
  end if;
  delete from public.conversaciones where id = p_conversacion_id and tipo = 'canal';
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.directorio_usuarios()',
    'public.participantes_conversacion(uuid)',
    'public.enviar_mensaje(uuid, text, jsonb, jsonb)',
    'public.marcar_leidos(uuid, timestamptz)',
    'public.resumen_conversaciones()',
    'public.abrir_directo(uuid)',
    'public.conversacion_de_pedido(uuid)',
    'public.crear_canal(text, text, uuid[])',
    'public.editar_canal(uuid, text, text)',
    'public.agregar_miembros(uuid, uuid[])',
    'public.quitar_miembro(uuid, uuid)',
    'public.eliminar_canal(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── 7. Avisos: menciones y directos ─────────────────────────────────────────

create function public.notificar_mensaje()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c         public.conversaciones;
  v_codigo  text;
  v_url     text;
  v_texto   text;
  v_lugar   text;
  v_dest    uuid;
  v_avisado uuid[] := '{}';
begin
  -- Los mensajes copiados por la migración (sin sesión) no avisan.
  if auth.uid() is null then
    return null;
  end if;

  select * into c from public.conversaciones where id = new.conversacion_id;

  if c.tipo = 'pedido' then
    select p.codigo into v_codigo from public.pedidos p where p.id = c.pedido_id;
    v_url := '/pedidos/' || v_codigo || '?chat=1';
    v_lugar := 'el pedido ' || v_codigo;
  else
    v_url := '/chat/' || c.id;
    v_lugar := case c.tipo when 'general' then 'General' when 'canal' then '#' || c.nombre else 'un mensaje directo' end;
  end if;

  v_texto := left(public.texto_con_etiquetas(new.texto, new.referencias), 180);
  if v_texto = '' then
    v_texto := 'Envió un archivo.';
  end if;

  if c.tipo = 'directo' then
    select m.usuario_id into v_dest
      from public.conversacion_miembros m
     where m.conversacion_id = c.id and m.usuario_id <> new.autor_id
     limit 1;
    if v_dest is not null then
      insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, url)
      values (v_dest, 'mensaje_directo', new.autor_nombre, v_texto, v_url);
      v_avisado := v_avisado || v_dest;
    end if;
  end if;

  for v_dest in
    select distinct (r ->> 'id')::uuid
      from jsonb_array_elements(new.referencias) r
     where r ->> 'tipo' = 'usuario'
       and (r ->> 'id') ~ '^[0-9a-f-]{36}$'
  loop
    if v_dest <> new.autor_id
       and not (v_dest = any (v_avisado))
       and public.puede_ver_conversacion_de(c.id, v_dest) then
      insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, url, pedido_id)
      values (v_dest, 'mencion', new.autor_nombre || ' te mencionó en ' || v_lugar, v_texto, v_url, c.pedido_id);
      v_avisado := v_avisado || v_dest;
    end if;
  end loop;

  return null;

exception when others then
  -- Como en `notificar_pedido`: perder un aviso antes que perder el mensaje.
  raise warning 'notificar_mensaje: no se pudo encolar el aviso del mensaje %: %', new.id, sqlerrm;
  return null;
end $$;

revoke execute on function public.notificar_mensaje() from public, anon, authenticated;

create trigger mensajes_notificar
  after insert on public.mensajes
  for each row execute function public.notificar_mensaje();

-- ── 8. Realtime ─────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.mensajes;
    alter publication supabase_realtime add table public.mensaje_lecturas;
    alter publication supabase_realtime add table public.mensaje_adjuntos;
  end if;
end $$;

-- ── 9. Los mensajes del chat de pedido de antes ─────────────────────────────

insert into public.conversaciones (tipo, pedido_id, creado_en, ultimo_mensaje_en)
select 'pedido', pm.pedido_id, min(pm.creado_en), max(pm.creado_en)
  from public.pedido_mensajes pm
 group by pm.pedido_id;

-- Sin sesión, el trigger de firma respeta autor y fecha.
insert into public.mensajes (id, conversacion_id, autor_id, autor_nombre, autor_rol, texto, creado_en)
select pm.id, c.id, pm.autor_id, pm.autor_nombre, pm.autor_rol, pm.texto, pm.creado_en
  from public.pedido_mensajes pm
  join public.conversaciones c on c.pedido_id = pm.pedido_id;

drop table public.pedido_mensajes;
drop function public.firmar_mensaje_pedido();
