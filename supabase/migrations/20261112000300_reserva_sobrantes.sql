-- La reserva de sobrantes para un pedido (piloto de sobrantes).
--
-- El cálculo de un corte usa primero los sobrantes del almacén. Al registrar el
-- pedido, el acomodo se rehace con los que están disponibles en ese momento y
-- esos quedan reservados para él, en la misma transacción: dos pedidos no
-- pueden contar con la misma pieza. Al cerrar la producción se consumen; si el
-- pedido se anula, vuelven a estar disponibles.
--
-- `pedido_id` / `linea_posicion` siguen diciendo de qué corte *nació* un
-- sobrante. La reserva va aparte: un sobrante nacido de un pedido puede
-- reservarse después para otro.

alter table public.sobrantes
  add column reserva_pedido_id uuid references public.pedidos (id) on delete set null,
  add column reserva_posicion smallint,
  add constraint sobrantes_reserva_completa
    check ((reserva_pedido_id is null) = (reserva_posicion is null));

create index sobrantes_reserva_idx on public.sobrantes (reserva_pedido_id) where reserva_pedido_id is not null;

comment on column public.sobrantes.pedido_id is 'El pedido de cuyo corte nació (origen = corte).';
comment on column public.sobrantes.reserva_pedido_id is 'El pedido que lo tiene reservado o lo consumió.';

-- Reserva los sobrantes de un corte y guarda su acomodo nuevo, todo o nada.
--
-- `p_codigos` son los sobrantes que usa el acomodo `p_corte`. Los que esta línea
-- tenía reservados y ya no usa se liberan. Si alguno de los pedidos ya no está
-- disponible —se lo llevó otro pedido—, falla con SOBRANTE_OCUPADO y no cambia
-- nada: quien llama rehace el acomodo sin él y vuelve a intentar.
create function public.reservar_sobrantes_de_corte(
  p_cotizacion uuid,
  p_posicion   smallint,
  p_corte      jsonb,
  p_codigos    text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido    uuid;
  v_codigos   text[] := coalesce(p_codigos, '{}');
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
     set corte = p_corte
   where cotizacion_id = p_cotizacion
     and posicion = p_posicion
     and tipo = 'corte';
  if not found then
    raise exception 'Esa línea no es un corte de esa cotización';
  end if;
end $$;

-- Al cerrar la producción: los reservados de un corte pasan a consumidos.
-- Al anular el pedido (`p_posicion` nulo): todos sus reservados se liberan.
create function public.soltar_sobrantes_de_pedido(p_codigo text, p_consumir boolean, p_posicion smallint default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido uuid;
  v_n      integer;
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede mover sobrantes';
  end if;
  select id into v_pedido from public.pedidos where codigo = p_codigo;
  if v_pedido is null then return 0; end if;

  if p_consumir then
    update public.sobrantes
       set estado = 'consumido'
     where reserva_pedido_id = v_pedido
       and reserva_posicion = p_posicion
       and estado = 'reservado';
  else
    update public.sobrantes
       set estado = 'disponible', reserva_pedido_id = null, reserva_posicion = null
     where reserva_pedido_id = v_pedido
       and estado = 'reservado';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.reservar_sobrantes_de_corte(uuid, smallint, jsonb, text[]) from public, anon;
revoke execute on function public.soltar_sobrantes_de_pedido(text, boolean, smallint) from public, anon;
grant execute on function public.reservar_sobrantes_de_corte(uuid, smallint, jsonb, text[]) to authenticated;
grant execute on function public.soltar_sobrantes_de_pedido(text, boolean, smallint) to authenticated;
