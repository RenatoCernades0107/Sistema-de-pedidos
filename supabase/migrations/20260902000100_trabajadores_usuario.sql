-- Enlaza a un trabajador con su cuenta en la app, para poder avisarle.
--
-- `trabajadores` y `usuarios` nacieron separadas a propósito (20260830000200):
-- se asigna un pedido a un operario que no tiene cuenta. Eso sigue valiendo, pero
-- sin ninguna relación entre las dos tablas no hay a quién mandarle la
-- notificación del pedido que acaba de caer a su nombre.
--
-- La columna es NULL-able porque "sin cuenta" es un estado legítimo, no un error:
-- ese trabajador simplemente no recibe avisos. Administración lo enlaza a mano
-- desde /equipo cuando la persona tenga cuenta.

alter table public.trabajadores
  add column usuario_id uuid unique
    references public.usuarios (id) on delete set null;

comment on column public.trabajadores.usuario_id is
  'Cuenta de la app de este trabajador, si tiene. NULL = no recibe notificaciones.';

-- `unique`: una cuenta pertenece como mucho a un trabajador. Sin esto dos filas
-- podrían apuntar a la misma persona y le llegaría el mismo aviso dos veces.
--
-- `on delete set null` y no `cascade`: dar de baja una cuenta no puede borrar al
-- trabajador, porque su nombre está en el responsable de los pedidos viejos.

-- Enlace inicial por nombre. Los cinco trabajadores (Juan, Isaac, Angel, Clever,
-- John) tienen un `usuarios.nombre` idéntico en la base de producción.
--
-- No es un enlace que se pueda dar por bueno para siempre —dos personas pueden
-- llamarse igual—, por eso existe la pantalla de /equipo para corregirlo. El
-- `not exists` protege el unique si algún día hay dos trabajadores homónimos, y
-- el conjunto vacío es un resultado válido: en la base sembrada con seed.sql los
-- usuarios son Ana Torres / Carla Díaz / Miguel Ruiz y no coincide ninguno.
update public.trabajadores t
   set usuario_id = u.id
  from public.usuarios u
 where u.nombre = t.nombre
   and u.activo
   and t.usuario_id is null
   and not exists (
     select 1 from public.trabajadores t2 where t2.usuario_id = u.id
   );
