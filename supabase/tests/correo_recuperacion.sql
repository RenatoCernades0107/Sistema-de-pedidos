-- Verifica las migraciones 20261201000100 (correo de recuperación) y 20261202000100
-- (la traducción usuario → correo exige la clave del servidor). Necesita la seed (usa
-- a `ana` y el secreto 'login' de desarrollo). Termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/correo_recuperacion.sql

begin;

do $$
declare
  ana uuid := (select id from public.usuarios where usuario = 'ana');
  clave text := (select valor from public.secretos_app where nombre = 'login');
begin
  if clave is null then raise exception 'falta el secreto login de secretos_app (lo pone seed.sql)'; end if;
  if ana is null then raise exception 'falta la cuenta ana del seed'; end if;

  if public.tiene_correo_recuperacion('ana', clave) then
    raise exception 'ana no debería tener correo de recuperación todavía';
  end if;

  -- Auth confirma un correo nuevo: el trigger lo copia al perfil.
  update auth.users set email = 'ana.real@example.com' where id = ana;

  if (select email from public.usuarios where id = ana) <> 'ana.real@example.com' then
    raise exception 'usuarios.email no siguió al correo de auth';
  end if;
  if (select email_recuperacion from public.usuarios where id = ana) <> 'ana.real@example.com' then
    raise exception 'email_recuperacion no se llenó';
  end if;

  -- Y el login sigue resolviendo el usuario al correo nuevo.
  if public.email_de_usuario('Ana', clave) <> 'ana.real@example.com' then
    raise exception 'email_de_usuario no devuelve el correo nuevo';
  end if;
  if not public.tiene_correo_recuperacion(' ANA ', clave) then
    raise exception 'tiene_correo_recuperacion debería ser true';
  end if;
  if public.tiene_correo_recuperacion('no-existe', clave) then
    raise exception 'un usuario inexistente no tiene correo';
  end if;

  -- Sin la clave —o con una mala— no se entrega nada: el correo es de la persona.
  if public.email_de_usuario('ana', 'clave-equivocada') is not null
     or public.email_de_usuario('ana', '') is not null
     or public.email_de_usuario('ana', null) is not null then
    raise exception 'email_de_usuario respondió sin la clave correcta';
  end if;
  if public.tiene_correo_recuperacion('ana', 'clave-equivocada') then
    raise exception 'tiene_correo_recuperacion respondió sin la clave correcta';
  end if;

  -- El CHECK de formato.
  begin
    update public.usuarios set email_recuperacion = 'sin-arroba' where id = ana;
    raise exception 'el CHECK de formato no rechazó un correo inválido';
  exception when check_violation then null;
  end;
end $$;

-- Los roles de la API no leen los secretos ni cierran sesiones ajenas.
set local role anon;
do $$
begin
  begin
    perform 1 from public.secretos_app;
    raise exception 'anon pudo leer secretos_app';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cerrar_sesiones_de(gen_random_uuid());
    raise exception 'anon pudo ejecutar cerrar_sesiones_de';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.cerrar_sesiones_de(gen_random_uuid());
    raise exception 'authenticated pudo ejecutar cerrar_sesiones_de';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
