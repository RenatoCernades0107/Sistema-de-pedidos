-- Verifica la migración 20261209000100: el rol de un perfil nuevo solo se toma de
-- `raw_app_meta_data`. Quien se registra por su cuenta solo controla `user_metadata`
-- y no puede darse un rol. Termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/signup_publico.sql

begin;

-- Alta "pública": el rol viaja en user_metadata, como lo mandaría un atacante.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000e1a1', 'sig-intruso@prueba.test',
   '{"nombre":"Intruso","usuario":"sig-intruso","rol":"administracion"}');

-- Alta de la Edge Function: el rol viaja en app_metadata.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000e1a2', 'sig-legitimo@prueba.test',
   '{"nombre":"Legítimo","usuario":"sig-legitimo"}',
   '{"rol":"logistica"}');

do $$
declare
  intruso public.usuarios;
  legitimo public.usuarios;
begin
  select * into intruso from public.usuarios where usuario = 'sig-intruso';
  if intruso.id is null then raise exception 'no se creó el perfil del alta pública'; end if;
  if intruso.activo then
    raise exception 'un alta con rol solo en user_metadata no puede quedar activa';
  end if;
  if intruso.rol = 'administracion' then
    raise exception 'el rol de user_metadata no puede llegar al perfil';
  end if;

  select * into legitimo from public.usuarios where usuario = 'sig-legitimo';
  if not legitimo.activo then raise exception 'el alta con rol en app_metadata debe quedar activa'; end if;
  if legitimo.rol <> 'logistica' then
    raise exception 'el rol de app_metadata no llegó al perfil (llegó %)', legitimo.rol;
  end if;

  -- Una cuenta desactivada no tiene rol efectivo: la RLS no le deja nada.
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000e1a1","role":"authenticated"}', true);
  if public.auth_rol() is not null then
    raise exception 'auth_rol() debe ser NULL para la cuenta sin rol';
  end if;
end $$;

rollback;
