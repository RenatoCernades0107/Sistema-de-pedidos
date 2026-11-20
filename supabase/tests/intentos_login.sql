-- Verifica la migración 20261209000200: el bloqueo temporal del login por usuario y
-- por IP. Necesita la seed (usa el secreto 'login' de desarrollo). Termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/intentos_login.sql

begin;

do $$
declare
  clave text := (select valor from public.secretos_app where nombre = 'login');
  i int;
begin
  if clave is null then raise exception 'falta el secreto login de secretos_app (lo pone seed.sql)'; end if;

  -- Sin intentos, no hay bloqueo.
  if public.login_bloqueado('prueba-bloqueo', '10.9.9.1', clave) then
    raise exception 'no debería haber bloqueo sin intentos';
  end if;

  -- Cuatro fallos todavía no bloquean; el quinto sí (y no distingue mayúsculas).
  for i in 1..4 loop
    perform public.registrar_intento_fallido('Prueba-Bloqueo ', '10.9.9.1', clave);
  end loop;
  if public.login_bloqueado('prueba-bloqueo', '10.9.9.1', clave) then
    raise exception 'cuatro fallos no deberían bloquear';
  end if;

  perform public.registrar_intento_fallido('prueba-bloqueo', '10.9.9.1', clave);
  if not public.login_bloqueado('prueba-bloqueo', '10.9.9.2', clave) then
    raise exception 'el quinto fallo debe bloquear al usuario aunque cambie la IP';
  end if;

  -- Otro usuario desde otra IP no se ve afectado.
  if public.login_bloqueado('otra-persona', '10.9.9.3', clave) then
    raise exception 'el bloqueo de un usuario no debe tocar a otro';
  end if;

  -- Pasada la ventana de 15 minutos se levanta.
  update public.intentos_login set creado_en = now() - interval '16 minutes'
   where usuario = 'prueba-bloqueo';
  if public.login_bloqueado('prueba-bloqueo', null, clave) then
    raise exception 'el bloqueo debe levantarse a los 15 minutos';
  end if;

  -- Un ingreso correcto borra los fallos.
  for i in 1..5 loop
    perform public.registrar_intento_fallido('prueba-limpiar', null, clave);
  end loop;
  if not public.login_bloqueado('prueba-limpiar', null, clave) then
    raise exception 'debería estar bloqueado antes de limpiar';
  end if;
  perform public.limpiar_intentos_login('prueba-limpiar', clave);
  if public.login_bloqueado('prueba-limpiar', null, clave) then
    raise exception 'limpiar_intentos_login no levantó el bloqueo';
  end if;

  -- La IP también bloquea: 20 fallos de usuarios distintos desde la misma dirección.
  for i in 1..20 loop
    perform public.registrar_intento_fallido('usuario-' || i, '10.9.9.50', clave);
  end loop;
  if not public.login_bloqueado('alguien-nuevo', '10.9.9.50', clave) then
    raise exception '20 fallos desde una IP deben bloquearla';
  end if;

  -- Sin la clave del servidor las funciones no hacen nada.
  perform public.registrar_intento_fallido('sin-clave', null, 'clave-equivocada');
  if exists (select 1 from public.intentos_login where usuario = 'sin-clave') then
    raise exception 'registrar_intento_fallido no debe escribir con una clave inválida';
  end if;
  if public.login_bloqueado('prueba-bloqueo-nuevo', '10.9.9.50', 'clave-equivocada') then
    raise exception 'login_bloqueado debe devolver false con una clave inválida';
  end if;

  -- Se purga lo de más de un día al registrar.
  insert into public.intentos_login (usuario, ip, creado_en)
  values ('viejo', null, now() - interval '2 days');
  perform public.registrar_intento_fallido('purga', null, clave);
  if exists (select 1 from public.intentos_login where usuario = 'viejo') then
    raise exception 'los intentos de más de un día deben purgarse';
  end if;
end $$;

-- anon y authenticated no tocan la tabla directamente.
do $$
begin
  if has_table_privilege('anon', 'public.intentos_login', 'select')
     or has_table_privilege('authenticated', 'public.intentos_login', 'select') then
    raise exception 'intentos_login no debe ser legible desde la API';
  end if;
end $$;

rollback;
