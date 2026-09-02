-- Las dos tablas del sistema de avisos: a qué navegadores se manda y qué está por
-- mandarse.
--
-- El diseño es una cola, no un envío directo. La base solo anota "hay que avisarle
-- esto a esta persona"; quien firma y manda es la Edge Function `enviar-push`.
-- Se parte así porque firmar un push exige la clave privada VAPID, que es un
-- secreto de servidor, y la app web no guarda ninguno (ver .env.example). La cola
-- también hace que un push que falla se reintente en vez de perderse.

create type public.tipo_notificacion as enum (
  'pedido_creado',
  'responsable_asignado'
);

-- ── Suscripciones: un navegador que aceptó recibir avisos ────────────────────

create table public.suscripciones_push (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,

  -- Lo que devuelve pushManager.subscribe() en el navegador. `endpoint` es la URL
  -- del servicio de push (FCM, Mozilla, Apple); p256dh y auth son las claves con
  -- las que se cifra el payload para que el servicio no pueda leerlo.
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,

  navegador  text,
  creado_en  timestamptz not null default now(),
  usada_en   timestamptz
);

comment on table public.suscripciones_push is
  'Un navegador suscrito a los avisos. Una persona tiene tantas filas como dispositivos.';

-- El unique va sobre `endpoint` solo, no sobre (usuario_id, endpoint): el endpoint
-- identifica una instalación de navegador, no a una persona. Si dos operarios usan
-- la misma PC del taller, el segundo que se suscriba recibe EL MISMO endpoint; con
-- el unique global el upsert le reasigna el dueño en vez de dejar dos filas que
-- mandarían los pedidos del primero al navegador del segundo.

create index suscripciones_push_usuario_idx on public.suscripciones_push (usuario_id);

alter table public.suscripciones_push enable row level security;

-- Cada quien ve y escribe solo lo suyo. El endpoint de otro no se lee ni de
-- casualidad: quien lo tenga puede mandarle notificaciones a esa persona.
create policy suscripciones_propias on public.suscripciones_push
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- ── Notificaciones: la cola ──────────────────────────────────────────────────

create table public.notificaciones (
  id              bigserial primary key,
  destinatario_id uuid not null references public.usuarios (id) on delete cascade,
  tipo            public.tipo_notificacion not null,

  -- El texto ya resuelto. Se guarda hecho, no como plantilla + datos, para que lo
  -- que se mandó quede escrito tal cual: si mañana cambia el texto, el aviso viejo
  -- sigue diciendo lo que la persona leyó.
  titulo          text not null,
  cuerpo          text not null,
  url             text not null default '/',

  pedido_id       uuid references public.pedidos (id) on delete cascade,
  creado_en       timestamptz not null default now(),

  -- tomada_en la pone quien va a enviarla, para que dos envíos simultáneos no
  -- manden lo mismo dos veces. enviada_en la pone al terminar.
  tomada_en       timestamptz,
  enviada_en      timestamptz,
  intentos        smallint not null default 0,
  error           text
);

comment on table public.notificaciones is
  'Cola de avisos por enviar. La llena un trigger; la vacía la Edge Function enviar-push.';

-- Índice parcial: la única consulta que corre seguido es "las que faltan enviar",
-- y esa lista es siempre corta. Las ya enviadas no tienen por qué estorbar.
create index notificaciones_pendientes_idx on public.notificaciones (creado_en)
  where enviada_en is null;

create index notificaciones_destinatario_idx
  on public.notificaciones (destinatario_id, creado_en desc);

alter table public.notificaciones enable row level security;

-- Solo se leen las propias (y Administración las ve todas, para poder responder
-- "¿le avisamos o no?"). Nadie escribe desde la app: la llena el trigger con
-- SECURITY DEFINER y la vacía la función con la clave de servicio.
create policy notificaciones_propias on public.notificaciones
  for select to authenticated
  using (destinatario_id = auth.uid() or public.es_admin());
