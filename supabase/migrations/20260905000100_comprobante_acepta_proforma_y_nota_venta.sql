-- El negocio ahora también emite proformas y notas de venta, no solo facturas y
-- boletas. `pedidos_comprobante_formato` (de `20260901000800`) solo aceptaba `F` y
-- `B`; esta migración amplía el mismo CHECK, sin tocar columna, vistas ni trigger.
--
-- `P` proforma sigue el mismo patrón que factura/boleta (letra + serie de 3). `NV`
-- nota de venta usa dos letras porque así la pidió el negocio; el resto del formato
-- (serie de 3, correlativo de hasta 8) no cambia para ninguno de los dos.
--
-- El tipo se sigue derivando del prefijo en `lib/dominio.ts` (`tipoComprobante`),
-- nunca de una columna aparte.

alter table public.pedidos
  drop constraint pedidos_comprobante_formato;

alter table public.pedidos
  add constraint pedidos_comprobante_formato
  check (numero_comprobante is null or numero_comprobante ~ '^(?:[FBP]|NV)[0-9]{3}-[0-9]{1,8}$');
