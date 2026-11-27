-- Una orden de compra de Odoo es UNA compra de la app.
--
-- Al traer de Odoo las órdenes que la app no tenía (Compras → "Traer de Odoo"),
-- dos personas pueden pedirlo a la vez. Este índice hace que la segunda no
-- duplique: la base rechaza la orden repetida y la app la salta.

create unique index compras_odoo_orden_unica_idx
  on public.compras (odoo_orden_id)
  where odoo_orden_id is not null;
