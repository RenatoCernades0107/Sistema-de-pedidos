-- Entrar con usuario y contraseña, no con correo.
--
-- Supabase Auth solo autentica por correo o teléfono, así que el correo sigue
-- existiendo por debajo: es un identificador interno. Lo que la gente escribe es
-- su usuario, y una función lo traduce al correo antes de autenticar.

alter table public.usuarios add column usuario text;

-- Los tres del seed ya tienen correo: el usuario es lo que va antes de la arroba.
update public.usuarios set usuario = lower(split_part(email, '@', 1));

alter table public.usuarios alter column usuario set not null;

-- Se guarda en minúsculas y se compara en minúsculas: "Ana" y "ana" no pueden ser
-- dos cuentas distintas, y nadie va a recordar cómo lo escribió el día del alta.
alter table public.usuarios add constraint usuarios_usuario_formato
  check (usuario ~ '^[a-z0-9][a-z0-9._-]{2,29}$');

create unique index usuarios_usuario_key on public.usuarios (usuario);

comment on column public.usuarios.usuario is
  'Lo que la persona escribe para entrar. El email de auth.users es interno.';

-- El perfil se sigue creando solo al dar de alta la cuenta; ahora también fija el
-- usuario, que puede venir en la metadata o salir del correo.
create or replace function public.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.usuarios (id, nombre, email, usuario, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    new.email,
    lower(coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1))),
    coalesce((new.raw_user_meta_data ->> 'rol')::public.rol, 'operaciones')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Traduce usuario → correo antes de autenticar. La llama el servidor de la app,
-- con la clave publicable y sin sesión todavía, así que va con SECURITY DEFINER:
-- la RLS de `usuarios` no deja leer nada a quien no ha entrado.
--
-- No revela más de lo que ya se puede deducir: el correo es interno y sigue el
-- mismo patrón para todos. Y no dice nada de la contraseña.
create function public.email_de_usuario(nombre_usuario text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email
  from public.usuarios u
  where u.usuario = lower(btrim(nombre_usuario))
    and u.activo
$$;

grant execute on function public.email_de_usuario(text) to anon, authenticated;

-- ── Arreglo del seed de auth.users ──────────────────────────────────────────
--
-- GoTrue lee estas columnas como texto, no como texto nullable: con NULL, el
-- inicio de sesión falla con un error de base de datos que no dice nada. Una
-- cuenta creada desde el panel las trae en cadena vacía; una sembrada a mano, no.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '');

-- Para el proveedor `email`, el panel guarda el uuid del usuario como
-- `provider_id`. Dejarlo igual evita sorpresas al vincular cuentas.
update auth.identities
set provider_id = user_id::text
where provider = 'email' and provider_id <> user_id::text;
