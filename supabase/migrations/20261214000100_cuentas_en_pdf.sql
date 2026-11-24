-- Elegir cuáles de las cuentas para depósito salen en el PDF de la cotización.
--
-- `en_pdf` es lo único de una cuenta que se puede cambiar (además de retirarla),
-- y solo en una dirección segura: ocultar una cuenta no le roba a nadie, y
-- mostrar una que ya pasó por las 24 horas de espera tampoco, porque
-- `cotizacion_publica()` sigue exigiendo que esté vigente y no retirada. Por eso
-- no pide contraseña, solo ser Administración. Una cuenta nueva nace con
-- `en_pdf = true`: el comportamiento de antes.

alter table public.cuentas_bancarias add column en_pdf boolean not null default true;

-- `cuentas_bancarias_inmutables` solo compara los datos de la cuenta, así que
-- `en_pdf` ya puede cambiar; el UPDATE de la función no toca nada más.
create function public.mostrar_cuenta_en_pdf(p_id uuid, p_mostrar boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo Administración maneja las cuentas bancarias.' using errcode = '42501';
  end if;

  update public.cuentas_bancarias
     set en_pdf = p_mostrar
   where id = p_id and retirada_en is null;

  if not found then
    raise exception 'Esa cuenta no existe o ya estaba retirada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.mostrar_cuenta_en_pdf(uuid, boolean) from public, anon;
grant execute on function public.mostrar_cuenta_en_pdf(uuid, boolean) to authenticated;

-- El aviso de alta/retiro no debe saltar por este cambio: ya devuelve null en
-- cualquier UPDATE que no sea un retiro.

-- El PDF público: igual que antes, más `and cb.en_pdf`.
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
        and cb.en_pdf
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
