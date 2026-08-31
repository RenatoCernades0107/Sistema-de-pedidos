-- Cambiar la contraseña la primera vez que se entra.
--
-- Las cuentas no se registran solas: las crea Administración desde el panel de
-- Supabase y le pasa la contraseña a la persona por WhatsApp o de viva voz.
-- Mientras esa contraseña siga en pie, quien creó la cuenta —y cualquiera que
-- haya visto el mensaje— puede entrar como su dueño. La marca cierra esa ventana:
-- se pone sola al nacer la cuenta y solo la baja su dueño, después de cambiarla.

alter table public.usuarios
  add column debe_cambiar_password boolean not null default true;

comment on column public.usuarios.debe_cambiar_password is
  'La cuenta todavía usa la contraseña con la que la crearon. Hasta que no la cambie, la app no la deja pasar del formulario de cambio.';

-- Añadir la columna con DEFAULT la escribe también en las filas que ya existen,
-- que es justo lo que hace falta: las tres cuentas del seed comparten la misma
-- contraseña y hasta hoy nadie las obligó a cambiarla.

-- Baja la marca del propio usuario y de nadie más.
--
-- Hace falta una función y no una política de UPDATE: la única que hay sobre
-- `usuarios` es la de Administración, y ensancharla para que cada quien edite su
-- fila dejaría a un operario cambiarse el `rol`. Con SECURITY DEFINER la
-- escritura es exactamente esta columna, en exactamente esta fila. Sin sesión,
-- `auth.uid()` es NULL y el UPDATE no toca nada.
create function public.marcar_password_cambiada()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.usuarios
     set debe_cambiar_password = false
   where id = auth.uid()
$$;

revoke execute on function public.marcar_password_cambiada() from public;
grant execute on function public.marcar_password_cambiada() to authenticated;
