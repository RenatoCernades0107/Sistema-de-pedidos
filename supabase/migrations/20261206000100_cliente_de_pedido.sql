-- El documento del cliente (RUC o DNI) en el detalle del pedido.
--
-- Se guardó en la cotización de la que salió el pedido, y `cotizaciones` es de
-- Administración (su RLS). Logística también coordina con el cliente —ya ve su
-- nombre y su teléfono—, así que lo lee por esta ventanilla, como las líneas y
-- el estado en Odoo. El taller no lo ve: no lo necesita para fabricar.

create function public.cliente_de_pedido(p_codigo text)
returns table (documento text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.cliente_documento
  from public.pedidos p
  join public.cotizaciones c on c.pedido_id = p.id
  where p.codigo = p_codigo
    and public.auth_rol() in ('administracion', 'logistica')
$$;

revoke execute on function public.cliente_de_pedido(text) from public, anon;
grant execute on function public.cliente_de_pedido(text) to authenticated;
