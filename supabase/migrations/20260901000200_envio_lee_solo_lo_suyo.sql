-- `validar_envio_provincia()` leía el pedido entero con `select *`.
--
-- Funcionó mientras el único que insertaba envíos era el dueño de las tablas: el
-- seed y las pruebas. En cuanto lo hace la app, el rol es `authenticated`, que no
-- tiene SELECT sobre `nombre_cliente`, `monto_total` ni `numero_factura`, y un
-- `select *` los toca todos: el alta de cualquier pedido a provincia moría con
-- «permission denied for table pedidos» sin llegar a validar nada.
--
-- La función necesita dos columnas, y las dos están en el GRANT del rol. Se piden
-- esas y no la fila entera. Subirla a `security definer` habría tapado el síntoma
-- abriendo la fila completa dentro de un trigger, que es justo lo que el GRANT por
-- columna existe para evitar.

create or replace function public.validar_envio_provincia()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  destino_provincia boolean;
  codigo_pedido     text;
begin
  select es_provincia, codigo
    into destino_provincia, codigo_pedido
    from public.pedidos
   where id = new.pedido_id;

  if not coalesce(destino_provincia, false) then
    raise exception 'El pedido % no es a provincia: no puede tener datos de envío', codigo_pedido;
  end if;

  return new;
end $$;
