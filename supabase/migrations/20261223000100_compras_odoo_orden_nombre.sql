-- El número de la orden de compra en Odoo (P01727) junto a la compra de la app.
--
-- Hasta ahora la lista mostraba solo CMP-000xx y la factura o proforma del
-- proveedor, y nadie podía cruzarla con Compras → Pedidos de Odoo. Las compras
-- traídas de Odoo ya lo llevaban en su nota ("Traída de Odoo: P01727."): de ahí se
-- rellena. Las creadas desde la app se rellenan la próxima vez que se pulse
-- "Traer de Odoo" y, de ahí en adelante, al confirmarlas.

alter table public.compras add column odoo_orden_nombre text
  check (odoo_orden_nombre is null or btrim(odoo_orden_nombre) <> '');

update public.compras
   set odoo_orden_nombre = substring(nota from 'Traída de Odoo: ([^. ]+)')
 where odoo_orden_nombre is null
   and nota like 'Traída de Odoo: %';
