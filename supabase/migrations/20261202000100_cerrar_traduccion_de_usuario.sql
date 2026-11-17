-- Que la traducción usuario → correo solo la pueda pedir el servidor de la app.
--
-- Desde que el correo de la cuenta es el real (`20261201000100`), `email_de_usuario`
-- —invocable sin sesión con la clave anon, que es pública— le entregaba el correo
-- de cualquier trabajador a quien conociera su usuario. Ahora pide además una clave
-- que solo conoce el servidor de Next (`LOGIN_SECRET`) y que el navegador nunca ve.
--
-- La clave vive en `secretos_app`, sin políticas de RLS y sin permisos para los roles
-- de la API: solo las funciones SECURITY DEFINER de abajo la leen. Su valor NO va en
-- una migración: se inserta a mano una vez (ver README).

create table public.secretos_app (
  nombre text primary key,
  valor  text not null check (length(valor) >= 16)
);

alter table public.secretos_app enable row level security;
revoke all on public.secretos_app from anon, authenticated;

comment on table public.secretos_app is
  'Secretos que la app comparte con funciones de la base. Sin políticas: solo las leen funciones SECURITY DEFINER.';

-- ¿Coincide la clave que llegó con la guardada? Sin clave guardada, nunca.
create function public.clave_de_login_valida(clave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.valor = clave from public.secretos_app s where s.nombre = 'login'),
    false)
$$;

revoke execute on function public.clave_de_login_valida(text) from public, anon, authenticated;

drop function public.email_de_usuario(text);
drop function public.tiene_correo_recuperacion(text);

create function public.email_de_usuario(nombre_usuario text, clave text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email
  from public.usuarios u
  where public.clave_de_login_valida(clave)
    and u.usuario = lower(btrim(nombre_usuario))
    and u.activo
$$;

create function public.tiene_correo_recuperacion(nombre_usuario text, clave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.email_recuperacion is not null
       from public.usuarios u
      where public.clave_de_login_valida(clave)
        and u.usuario = lower(btrim(nombre_usuario))
        and u.activo),
    false)
$$;

-- El login corre sin sesión, así que anon sigue pudiendo llamarlas: lo que las
-- protege es la clave, no el rol.
grant execute on function public.email_de_usuario(text, text) to anon, authenticated;
grant execute on function public.tiene_correo_recuperacion(text, text) to anon, authenticated;

-- Cerrar todas las sesiones de una cuenta (al desactivarla o restablecerle la
-- contraseña). GoTrue no lo hace solo: cambiar la contraseña deja vivos los tokens
-- de refresco. La llama la Edge Function `administrar-usuarios` con la clave de
-- servicio; ningún otro rol puede.
create function public.cerrar_sesiones_de(p_usuario_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from auth.sessions where user_id = p_usuario_id
$$;

revoke execute on function public.cerrar_sesiones_de(uuid) from public, anon, authenticated;
grant execute on function public.cerrar_sesiones_de(uuid) to service_role;
