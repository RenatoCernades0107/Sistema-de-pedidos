-- El rol de un perfil nuevo solo puede venir de `app_metadata`.
--
-- `crear_perfil_de_usuario` copiaba el rol de `raw_user_meta_data`. Esa metadata la
-- escribe quien se registra: con el alta pública de Auth abierta, bastaba llamar a
-- `/auth/v1/signup` con la clave publicable (que es pública) y `data: {"rol":
-- "administracion"}` para obtener un perfil activo de Administración.
--
-- `raw_app_meta_data` solo la fija quien tiene la clave de servicio (la Edge Function
-- `administrar-usuarios`) o acceso directo a la base. Desde aquí:
--   · el rol sale de `app_metadata`;
--   · una cuenta sin rol ahí nace DESACTIVADA (`auth_rol()` devuelve NULL y la RLS
--     no le deja ver ni hacer nada), en vez de entrar como `operaciones`;
--   · `nombre` y `usuario` siguen saliendo de `user_metadata`: no dan privilegios, y
--     un usuario repetido lo para el índice único.
--
-- Las cuentas ya creadas no cambian: el perfil solo se crea al dar de alta la cuenta.

create or replace function public.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text := new.raw_app_meta_data ->> 'rol';
begin
  insert into public.usuarios (id, nombre, email, usuario, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    new.email,
    lower(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1))),
    coalesce(v_rol::public.rol, 'operaciones'),
    v_rol is not null
  )
  on conflict (id) do nothing;
  return new;
end $$;

comment on function public.crear_perfil_de_usuario() is
  'Crea el perfil al dar de alta la cuenta en Auth. El rol sale SOLO de raw_app_meta_data; sin él, la cuenta nace desactivada.';
