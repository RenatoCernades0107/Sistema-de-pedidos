-- Verifica la migración 20261201000100 (correo de recuperación). Necesita la seed
-- (usa a `ana`). Termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/correo_recuperacion.sql

begin;

do $$
declare
  ana uuid := (select id from public.usuarios where usuario = 'ana');
begin
  if ana is null then raise exception 'falta la cuenta ana del seed'; end if;

  if public.tiene_correo_recuperacion('ana') then
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
  if public.email_de_usuario('Ana') <> 'ana.real@example.com' then
    raise exception 'email_de_usuario no devuelve el correo nuevo';
  end if;
  if not public.tiene_correo_recuperacion(' ANA ') then
    raise exception 'tiene_correo_recuperacion debería ser true';
  end if;
  if public.tiene_correo_recuperacion('no-existe') then
    raise exception 'un usuario inexistente no tiene correo';
  end if;

  -- El CHECK de formato.
  begin
    update public.usuarios set email_recuperacion = 'sin-arroba' where id = ana;
    raise exception 'el CHECK de formato no rechazó un correo inválido';
  exception when check_violation then null;
  end;
end $$;

rollback;
