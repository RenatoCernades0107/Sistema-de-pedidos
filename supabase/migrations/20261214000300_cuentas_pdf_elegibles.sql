-- Elegir las cuentas al descargar el PDF.
--
-- `cotizacion_publica()` deja de filtrar por `en_pdf`: devuelve todas las
-- cuentas vigentes y no retiradas (y anteriores a la emisión) con su `id` y su
-- `en_pdf`. Quien arma el PDF decide cuáles imprime: las marcadas en
-- Configuración, o las que se elijan al descargar. Nunca sale una cuenta que no
-- sea vigente: eso lo sigue garantizando esta función.

create or replace function public.cotizacion_publica(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'canal', c.canal,
    'odoo_partner_id', c.odoo_partner_id,
    'cliente_nombre', c.cliente_nombre,
    'cliente_documento', c.cliente_documento,
    'cliente_telefono', null,
    'odoo_order_id', c.odoo_order_id,
    'odoo_order_name', c.odoo_order_name,
    'sincronizacion', c.sincronizacion,
    'error_sincronizacion', null,
    'monto_sin_impuestos', c.monto_sin_impuestos,
    'monto_impuestos', c.monto_impuestos,
    'monto_total', c.monto_total,
    'notas', null,
    'chat_agente_id', null,
    'creado_en', c.creado_en,
    'confirmada_en_odoo', c.confirmada_en_odoo,
    'error_confirmacion', null,
    'creador', null,
    'pedido', null,
    -- Lo que Administración puso en /configuracion; 15 si nunca lo tocó. El
    -- mismo defecto que `VALIDEZ_POR_DEFECTO` en lib/cotizaciones-config.ts.
    'validez_dias', coalesce(
      (select case when jsonb_typeof(cfg.valor -> 'validezDias') = 'number'
                   then (cfg.valor ->> 'validezDias')::numeric::int end
         from public.configuracion cfg
        where cfg.clave = 'cotizaciones'),
      15
    ),
    'cuentas_bancarias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cb.id,
        'en_pdf', cb.en_pdf,
        'banco', cb.banco,
        'tipo', cb.tipo,
        'moneda', cb.moneda,
        'numero', cb.numero,
        'cci', cb.cci
      ) order by cb.moneda, cb.banco, cb.creada_en)
      from public.cuentas_bancarias cb
      where cb.retirada_en is null
        and cb.vigente_desde <= now()
        and cb.vigente_desde <= c.creado_en
    ), '[]'::jsonb),
    'cotizacion_productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'posicion', cp.posicion,
        'odoo_product_id', cp.odoo_product_id,
        'producto_nombre', cp.producto_nombre,
        'producto_codigo', cp.producto_codigo,
        'descripcion', cp.descripcion,
        'cantidad', cp.cantidad,
        'precio_unitario', cp.precio_unitario,
        'tipo', cp.tipo,
        'corte', cp.corte,
        'terminado', cp.terminado,
        'importe', cp.importe,
        'odoo_produccion_id', null
      ) order by cp.posicion)
      from public.cotizacion_productos cp
      where cp.cotizacion_id = c.id
    ), '[]'::jsonb)
  )
  from public.cotizaciones c
  where c.token_publico = p_token
$$;
