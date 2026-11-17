-- Correo de recuperación de contraseña.
--
-- Las cuentas nacen con un correo interno (`ana@plexiacril.test`) que no recibe
-- nada, así que "olvidé mi contraseña" no tenía a dónde mandar el enlace. Ahora
-- cada persona puede registrar su correo real desde la app.
--
-- Supabase Auth solo manda correos a la dirección de `auth.users.email`, así que
-- el correo de recuperación NO es una columna aparte que la app lee y usa: es la
-- dirección de la cuenta misma. Cambiarla desde la app (`auth.updateUser`) obliga
-- a confirmarla desde la bandeja nueva, que es lo que impide registrar el correo
-- de otra persona. Cuando Auth la cambia, este trigger la copia al perfil.

alter table public.usuarios add column email_recuperacion text;

alter table public.usuarios add constraint usuarios_email_recuperacion_formato
  check (email_recuperacion is null or email_recuperacion ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

comment on column public.usuarios.email_recuperacion is
  'Correo real, ya confirmado, al que llega el enlace de "olvidé mi contraseña". NULL = la cuenta solo tiene el correo interno y no se puede recuperar sola.';

-- Auth cambia el correo al confirmar el enlace (o desde el panel). `usuarios.email`
-- tiene que seguirlo siempre: `email_de_usuario` lo devuelve para autenticar, y si
-- se quedara con el viejo la persona no podría volver a entrar.
create function public.sincronizar_email_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.usuarios
     set email = new.email,
         email_recuperacion = new.email
   where id = new.id;
  return new;
end $$;

create trigger sincronizar_email_al_cambiar
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sincronizar_email_de_usuario();

-- ¿Esta cuenta tiene a dónde mandar el enlace? Solo responde sí o no: devolver
-- el correo le regalaría a cualquiera con un nombre de usuario la dirección de esa
-- persona. Sirve para no gastar el cupo de envíos de Auth en correos internos que
-- no existen.
create function public.tiene_correo_recuperacion(nombre_usuario text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.email_recuperacion is not null
       from public.usuarios u
      where u.usuario = lower(btrim(nombre_usuario))
        and u.activo),
    false)
$$;

grant execute on function public.tiene_correo_recuperacion(text) to anon, authenticated;
