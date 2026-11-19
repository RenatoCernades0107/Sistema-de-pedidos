-- La reserva de un sobrante elegido para un producto terminado.
--
-- Quien cotiza un producto terminado puede elegir sacarlo de un sobrante del
-- taller. Al registrar el pedido ese sobrante queda reservado para la línea, en
-- la misma transacción que guarda su ficha; al cerrar la producción se consume
-- (`soltar_sobrantes_de_pedido`, como los de un corte) y si el pedido se anula
-- vuelve a estar disponible.

-- Reserva los sobrantes de un producto terminado y guarda su ficha, todo o nada.
--
-- `p_codigos` son los sobrantes que usa la ficha `p_terminado`. Los que esta
-- línea tenía reservados y ya no usa se liberan. Si alguno ya no está
-- disponible —se lo llevó otro pedido—, falla con SOBRANTE_OCUPADO y no cambia
-- nada: quien llama rehace el acomodo sin él.
create function public.reservar_sobrantes_de_terminado(
  p_cotizacion uuid,
  p_posicion   smallint,
  p_terminado  jsonb,
  p_codigos    text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido     uuid;
  v_codigos    text[] := coalesce(p_codigos, '{}');
  v_reservados integer;
begin
  if not public.es_admin() then
    raise exception 'Solo Administración reserva sobrantes';
  end if;

  select pedido_id into v_pedido from public.cotizaciones where id = p_cotizacion;
  if v_pedido is null then
    raise exception 'Esa cotización todavía no tiene pedido';
  end if;

  update public.sobrantes
     set estado = 'disponible', reserva_pedido_id = null, reserva_posicion = null
   where reserva_pedido_id = v_pedido
     and reserva_posicion = p_posicion
     and estado = 'reservado'
     and not (codigo = any (v_codigos));

  update public.sobrantes
     set estado = 'reservado', reserva_pedido_id = v_pedido, reserva_posicion = p_posicion
   where codigo = any (v_codigos)
     and (estado = 'disponible'
          or (estado = 'reservado' and reserva_pedido_id = v_pedido and reserva_posicion = p_posicion));
  get diagnostics v_reservados = row_count;

  if v_reservados <> coalesce(array_length(v_codigos, 1), 0) then
    raise exception 'SOBRANTE_OCUPADO';
  end if;

  update public.cotizacion_productos
     set terminado = p_terminado
   where cotizacion_id = p_cotizacion
     and posicion = p_posicion
     and tipo = 'terminado';
  if not found then
    raise exception 'Esa línea no es un producto terminado de esa cotización';
  end if;
end $$;

revoke execute on function public.reservar_sobrantes_de_terminado(uuid, smallint, jsonb, text[]) from public, anon;
grant execute on function public.reservar_sobrantes_de_terminado(uuid, smallint, jsonb, text[]) to authenticated;
