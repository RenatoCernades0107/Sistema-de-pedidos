-- Límite de intentos de inicio de sesión, por usuario y por IP.
--
-- El único freno que había era el de Supabase Auth (`sign_in_sign_ups`, por IP). Las
-- peticiones salen del servidor de Next, así que todas llegan a Auth desde la misma
-- IP: el límite no distingue cuentas, y alguien probando contraseñas contra una sola
-- no se topa con nada hasta que agota el cupo de todos.
--
-- Aquí se cuenta cada fallo: un usuario se bloquea con 5 en 15 minutos, y una IP con
-- 20. Lo llama solo el servidor de la app, con la misma clave (`LOGIN_SECRET`) que
-- `email_de_usuario`; el navegador nunca ve estas funciones útiles.
--
-- Un bloqueo no se extiende solo: mientras está activo la app no registra más
-- intentos, así que a los 15 minutos del último fallo anterior se levanta.

create table public.intentos_login (
  id        bigint generated always as identity primary key,
  usuario   text not null,
  ip        text,
  creado_en timestamptz not null default now()
);

create index intentos_login_usuario_idx on public.intentos_login (usuario, creado_en);
create index intentos_login_ip_idx on public.intentos_login (ip, creado_en);

alter table public.intentos_login enable row level security;
revoke all on public.intentos_login from anon, authenticated;

comment on table public.intentos_login is
  'Intentos de inicio de sesión fallidos, para el bloqueo temporal. Sin políticas: solo las funciones SECURITY DEFINER de login la tocan.';

-- ¿Está bloqueado este usuario o esta IP? Sin la clave del servidor, siempre false.
create function public.login_bloqueado(nombre_usuario text, direccion_ip text, clave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.clave_de_login_valida(clave) and (
    (select count(*) from public.intentos_login i
      where i.usuario = left(lower(btrim(nombre_usuario)), 64)
        and i.creado_en > now() - interval '15 minutes') >= 5
    or (
      nullif(btrim(direccion_ip), '') is not null
      and (select count(*) from public.intentos_login i
            where i.ip = left(btrim(direccion_ip), 64)
              and i.creado_en > now() - interval '15 minutes') >= 20
    )
  )
$$;

-- Anota un intento fallido y purga lo de más de un día. Una IP vacía (la app no pudo
-- saberla) se guarda como NULL y no cuenta para el bloqueo por IP.
create function public.registrar_intento_fallido(nombre_usuario text, direccion_ip text, clave text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.clave_de_login_valida(clave) then return; end if;

  delete from public.intentos_login where creado_en < now() - interval '1 day';

  insert into public.intentos_login (usuario, ip)
  values (left(lower(btrim(nombre_usuario)), 64), nullif(left(btrim(direccion_ip), 64), ''));
end $$;

-- Un ingreso correcto borra los fallos previos de ese usuario.
create function public.limpiar_intentos_login(nombre_usuario text, clave text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.clave_de_login_valida(clave) then return; end if;

  delete from public.intentos_login
   where usuario = left(lower(btrim(nombre_usuario)), 64);
end $$;

-- El login corre sin sesión, así que anon tiene que poder llamarlas: lo que las
-- protege es la clave, no el rol.
grant execute on function public.login_bloqueado(text, text, text) to anon, authenticated;
grant execute on function public.registrar_intento_fallido(text, text, text) to anon, authenticated;
grant execute on function public.limpiar_intentos_login(text, text) to anon, authenticated;
