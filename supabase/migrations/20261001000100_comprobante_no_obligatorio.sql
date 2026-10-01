-- El comprobante deja de ser obligatorio para entregar.
--
-- `pedidos_comprobante_al_entregar` (20260901000800) impedía pasar a `entregado`
-- sin número de comprobante. Como solo Administración puede escribirlo, el taller
-- y Logística se quedaban con pedidos listos que no podían cerrar. Ahora el número
-- es opcional: Administración puede registrarlo al entregar si ya lo tiene.
--
-- El formato (`pedidos_comprobante_formato`) se mantiene: si hay número, tiene
-- que ser válido.

alter table public.pedidos
  drop constraint if exists pedidos_comprobante_al_entregar;
