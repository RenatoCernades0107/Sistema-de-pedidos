-- Borrar los datos de prueba antes de que entren los reales.
--
-- Se corre UNA vez desde el SQL Editor del proyecto, y NO se puede deshacer:
-- Supabase no guarda una copia de esto por su cuenta. Si quieres red de
-- seguridad, saca antes un respaldo (Studio → Database → Backups, o
-- `supabase db dump --data-only -f respaldo.sql`).
--
-- Va después de `usuarios_iniciales.sql`: primero existen las cuentas reales,
-- después se van las de prueba. Al revés te quedas un rato sin nadie que pueda
-- entrar como Administración.
--
-- El orden de aquí dentro tampoco es libre: los pedidos van primero porque
-- `pedidos.creado_por`, `pagos.registrado_por` y los dos historiales apuntan a
-- `usuarios` sin cascada; con pedidos vivos, borrar a Ana fallaría.

-- ── 1. Qué hay ahora ────────────────────────────────────────────────────────
--
-- Para poder comparar con el recuento del final.
select 'antes' as momento,
       (select count(*) from public.pedidos)            as pedidos,
       (select count(*) from public.pagos)              as pagos,
       (select count(*) from public.adjuntos)           as adjuntos,
       (select count(*) from public.envios_provincia)   as envios,
       (select count(*) from public.historial_estados)  as historial,
       (select count(*) from public.logs_auditoria)     as auditoria;

-- ── 2. Los pedidos ──────────────────────────────────────────────────────────
--
-- Una sola sentencia: `envios_provincia`, `pagos`, `adjuntos`,
-- `historial_estados` y `logs_auditoria` cuelgan de `pedidos.id` con
-- `on delete cascade`, así que se van solos y en el orden correcto.
--
-- `logs_auditoria` es inmutable para la app —anon y authenticated tienen
-- revocado el DELETE—, pero el SQL Editor corre como `postgres`, que es el dueño
-- de la tabla. La inmutabilidad protege de la app, no del dueño de la base: por
-- eso esto solo se puede hacer desde aquí, a mano y a propósito.
delete from public.pedidos;

-- ── 3. Las tres cuentas de prueba ───────────────────────────────────────────
--
-- Comparten la contraseña `plexi2026`, que está escrita en `supabase/seed.sql`
-- dentro del repositorio: mientras vivan, cualquiera que vea el repo entra como
-- Administración. El perfil de `public.usuarios` se va por cascada
-- (`usuarios.id references auth.users on delete cascade`), y con él su fila de
-- `auth.identities`.
delete from auth.users
where email in (
  'ana@plexiacril.test',
  'carla@plexiacril.test',
  'miguel@plexiacril.test'
);

-- ── 4. Cómo quedó ───────────────────────────────────────────────────────────
--
-- Los seis contadores en cero, y solo las nueve cuentas reales.
select 'después' as momento,
       (select count(*) from public.pedidos)            as pedidos,
       (select count(*) from public.pagos)              as pagos,
       (select count(*) from public.adjuntos)           as adjuntos,
       (select count(*) from public.envios_provincia)   as envios,
       (select count(*) from public.historial_estados)  as historial,
       (select count(*) from public.logs_auditoria)     as auditoria;

select u.usuario, u.nombre, u.rol, u.activo, u.debe_cambiar_password
from public.usuarios u
order by u.rol, u.usuario;

-- ── 5. Los archivos del bucket ──────────────────────────────────────────────
--
-- El seed solo insertó filas en `adjuntos`; nunca subió los archivos. Si nadie
-- probó a subir uno desde la app, esto devuelve cero filas y no hay nada que
-- hacer.
select o.name, o.created_at
from storage.objects o
where o.bucket_id = 'adjuntos'
order by o.created_at;

-- Si sí hay archivos, bórralos desde Studio → Storage → `adjuntos` → carpeta
-- `pedidos`. Borrar aquí la fila de `storage.objects` deja el archivo en el
-- almacenamiento sin nada que lo apunte: invisible, pero ocupando y facturando.
