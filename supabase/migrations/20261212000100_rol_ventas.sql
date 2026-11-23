-- El rol de Ventas: cotiza y registra pedidos, lee el almacén y los precios, y usa
-- el chat y los diseños. No ve métricas ni configuración.
--
-- Esta migración solo agrega el valor al enum. Un valor nuevo de un enum no se
-- puede usar en la misma transacción que lo crea (políticas, vistas, funciones),
-- así que todo lo que lo usa va en `20261212000200_ventas_permisos.sql`.

alter type public.rol add value if not exists 'ventas';
