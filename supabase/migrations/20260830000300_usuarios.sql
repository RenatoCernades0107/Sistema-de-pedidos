-- Perfiles de usuario y el helper de rol que usan todas las políticas de RLS.

create table public.usuarios (
  id        uuid primary key references auth.users (id) on delete cascade,
  nombre    text not null,
  email     text not null unique,
  rol       public.rol not null,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.usuarios is
  'Perfil 1:1 con auth.users. El rol vive aquí, no en el JWT, para poder cambiarlo sin reemitir sesiones.';

-- Alta automática del perfil cuando Supabase Auth crea la cuenta.
-- El rol llega en la metadata; si no viene, el usuario entra como `operaciones`,
-- que es el rol que menos ve. Un error de alta no puede abrir la caja.
create function public.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.usuarios (id, nombre, email, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'rol')::public.rol, 'operaciones')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger crear_perfil_al_registrar
  after insert on auth.users
  for each row execute function public.crear_perfil_de_usuario();

-- El rol del usuario de la petición actual.
--
-- `security definer` con `search_path` fijo no es opcional: sin él, cada política
-- que consulte `usuarios` dispararía la RLS de `usuarios` y entraría en recursión
-- infinita. Devuelve NULL si no hay sesión o si la cuenta está desactivada, y
-- todas las políticas tratan ese NULL como "no puede nada".
create function public.auth_rol()
returns public.rol
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rol from public.usuarios where id = auth.uid() and activo
$$;

create function public.es_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.auth_rol() = 'administracion'
$$;
