-- Corrige la hora de creación de los pedidos del seed.
--
-- El seed insertaba `fecha_creacion` como fecha pelada ('2026-08-19'). En una
-- columna timestamptz y con la sesión en UTC, eso es la medianoche UTC, que en
-- Lima es el día anterior a las 19:00: la app mostraba los pedidos creados un
-- día antes de lo que decía el prototipo.
--
-- Se recolocan a las 09:00 de Lima del mismo día, que es cuando abre la tienda y
-- no está cerca de ningún cambio de fecha. Solo toca las que cayeron justo en la
-- medianoche UTC: un pedido registrado por la app trae la hora real de `now()`.

-- `fecha_creacion` es inmutable por trigger, y con razón: nadie debe poder mover
-- la fecha en que se registró un pedido. Corregir el seed es la excepción, y se
-- hace desactivando el guardián a la vista de todos, no debilitándolo.
alter table public.pedidos disable trigger pedidos_inmutables;

update public.pedidos
set fecha_creacion = ((fecha_creacion at time zone 'UTC')::date + time '09:00')
                     at time zone 'America/Lima'
where (fecha_creacion at time zone 'UTC')::time = time '00:00';

alter table public.pedidos enable trigger pedidos_inmutables;
