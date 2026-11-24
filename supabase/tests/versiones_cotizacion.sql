-- Verificación de la migración 20261215000100 (borrador → enviada → reemplazada y
-- versiones de una cotización), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/versiones_cotizacion.sql
--
-- Como `cotizaciones.sql`, no necesita las cuentas del seed: entra como el primer
-- usuario activo de Administración. Todo dentro de una transacción que termina en
-- ROLLBACK: no deja nada.

begin;

select set_config('plexi.test_admin',
                  (select id::text from public.usuarios where rol = 'administracion' and activo
                    order by creado_en limit 1),
                  true);
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('plexi.test_admin'), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  v1 uuid;
  v2 uuid;
  c  public.cotizaciones%rowtype;
begin
  -- 1. Nace borrador, sin fecha de envío ni versión anterior.
  v1 := public.crear_cotizacion(
    p_odoo_partner_id := 900101,
    p_cliente_nombre  := 'Prueba SQL versiones',
    p_lineas := '[
      {"odoo_product_id": 10, "producto_nombre": "ACRILICO", "cantidad": 2, "precio_unitario": 100, "importe": 200},
      {"tipo": "corte", "odoo_product_id": 11, "producto_nombre": "Corte", "cantidad": 1, "precio_unitario": 50,
       "importe": 50, "corte": {"version": 1, "marca": 42}}
    ]'::jsonb,
    p_odoo_order_id := 990101, p_odoo_order_name := 'S990101'
  );
  select * into c from public.cotizaciones where id = v1;
  if c.estado <> 'borrador' or c.enviada_en is not null or c.version <> 1 or c.reemplaza_a is not null then
    raise exception 'FALLO: no nació como borrador v1: % % %', c.estado, c.enviada_en, c.version;
  end if;

  -- 2. Editar un borrador: cambia el cliente, conserva el corte, reemplaza el producto.
  perform public.actualizar_cotizacion(
    v1, 900102, 'Otro cliente',
    '[{"conservar": 2},
      {"odoo_product_id": 10, "producto_nombre": "ACRILICO", "cantidad": 3, "precio_unitario": 90, "importe": 270}]'::jsonb
  );
  select * into c from public.cotizaciones where id = v1;
  if c.odoo_partner_id <> 900102 or c.cliente_nombre <> 'Otro cliente' then
    raise exception 'FALLO: no se guardó el cliente nuevo';
  end if;
  if c.error_edicion is null then
    raise exception 'FALLO: una edición de algo que ya está en Odoo no quedó marcada como pendiente de Odoo';
  end if;
  if (select count(*) from public.cotizacion_productos where cotizacion_id = v1) <> 2 then
    raise exception 'FALLO: no quedaron las dos líneas';
  end if;
  if (select (corte ->> 'marca') from public.cotizacion_productos where cotizacion_id = v1 and tipo = 'corte') <> '42' then
    raise exception 'FALLO: el corte conservado cambió';
  end if;

  -- 3. Conservar una línea que no existe falla y no deja nada a medias.
  begin
    perform public.actualizar_cotizacion(v1, 900102, 'X', '[{"conservar": 9}]'::jsonb);
    raise exception 'FALLO: se aceptó conservar una línea que no existe';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;
  if (select count(*) from public.cotizacion_productos where cotizacion_id = v1) <> 2 then
    raise exception 'FALLO: una edición fallida dejó las líneas a medias';
  end if;

  -- 4. Con cambios que Odoo no tiene, no se envía.
  begin
    update public.cotizaciones set estado = 'enviada' where id = v1;
    raise exception 'FALLO: se envió con cambios que Odoo no tiene';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'COTIZACION_DESACTUALIZADA%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;

  -- 5. Con Odoo al día, se envía y se anota cuándo.
  update public.cotizaciones set error_edicion = null where id = v1;
  update public.cotizaciones set estado = 'enviada' where id = v1;
  if (select enviada_en from public.cotizaciones where id = v1) is null then
    raise exception 'FALLO: enviada sin fecha de envío';
  end if;

  -- 6. Enviada: la base no deja cambiar lo cotizado, venga de donde venga.
  begin
    perform public.actualizar_cotizacion(v1, 900102, 'X',
      '[{"odoo_product_id": 10, "producto_nombre": "P", "cantidad": 1, "precio_unitario": 1, "importe": 1}]'::jsonb);
    raise exception 'FALLO: se editó una cotización enviada';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'COTIZACION_BLOQUEADA%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;
  begin
    update public.cotizaciones set cliente_nombre = 'Hack' where id = v1;
    raise exception 'FALLO: se cambió el cliente de una enviada';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'COTIZACION_BLOQUEADA%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;
  begin
    delete from public.cotizacion_productos where cotizacion_id = v1;
    raise exception 'FALLO: se borraron líneas de una enviada';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'COTIZACION_BLOQUEADA%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;
  begin
    update public.cotizaciones set estado = 'borrador' where id = v1;
    raise exception 'FALLO: una enviada volvió a borrador';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'COTIZACION_ESTADO%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;

  -- 7. Versión nueva: un borrador v2 con lo mismo, que no hereda nada de Odoo.
  v2 := public.nueva_version_cotizacion(v1);
  select * into c from public.cotizaciones where id = v2;
  if c.estado <> 'borrador' or c.version <> 2 or c.reemplaza_a <> v1 then
    raise exception 'FALLO: la versión nueva no es un borrador v2 de la anterior';
  end if;
  if c.odoo_order_id is not null or c.sincronizacion <> 'pendiente' then
    raise exception 'FALLO: la versión nueva heredó la orden de Odoo';
  end if;
  if (select count(*) from public.cotizacion_productos where cotizacion_id = v2) <> 2
     or (select (corte ->> 'marca') from public.cotizacion_productos where cotizacion_id = v2 and tipo = 'corte') <> '42' then
    raise exception 'FALLO: la versión nueva no copió las líneas y el corte';
  end if;
  -- La original no se tocó.
  if (select estado from public.cotizaciones where id = v1) <> 'enviada' then
    raise exception 'FALLO: hacer la versión nueva movió la original';
  end if;

  -- 8. Una sola versión en curso, y solo de una enviada.
  begin
    perform public.nueva_version_cotizacion(v1);
    raise exception 'FALLO: se hizo una segunda versión nueva';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'VERSION_EXISTE%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;
  begin
    perform public.nueva_version_cotizacion(v2);
    raise exception 'FALLO: se hizo la versión nueva de un borrador';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
    if sqlerrm not like 'VERSION_NO_APLICA%' then raise exception 'FALLO: error inesperado: %', sqlerrm; end if;
  end;

  -- 9. Enviar la v2 deja la v1 como reemplazada.
  update public.cotizaciones
     set odoo_order_id = 990102, odoo_order_name = 'S990102', sincronizacion = 'sincronizada'
   where id = v2;
  update public.cotizaciones set estado = 'enviada' where id = v2;
  if (select estado from public.cotizaciones where id = v1) <> 'reemplazada' then
    raise exception 'FALLO: al enviar la v2, la v1 no quedó reemplazada';
  end if;

  -- 10. Lo que escribe el taller después (planchas usadas, indicaciones) sigue pudiéndose.
  update public.cotizacion_productos set planchas_usadas = 2, indicaciones = 'pegar'
   where cotizacion_id = v2 and tipo = 'producto';
end $$;

set local role postgres;

select 'versiones de cotización: todo en orden' as resultado;

rollback;
