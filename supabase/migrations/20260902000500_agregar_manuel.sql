-- Nuevo responsable de pedido: Manuel se suma al equipo.
--
-- El catálogo nace en `20260830000200_catalogos.sql` con Juan, Isaac, Angel,
-- Clever y John; esa migración ya está aplicada y no se toca. Sumar un
-- trabajador nuevo es solo un insert más, igual que el resto del catálogo.
insert into public.trabajadores (nombre) values ('Manuel');
