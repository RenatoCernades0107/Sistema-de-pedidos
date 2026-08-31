-- El taller también ve de quién es el pedido.
--
-- La regla original era que Operaciones produjera sin el dato comercial. En la
-- práctica el taller recibe llamadas por el pedido y solo tiene el código: sin el
-- nombre del cliente no puede identificar de qué hablan. El nombre pasa a ser un
-- dato de producción más; lo que sigue fuera de su vista es el teléfono (dato de
-- contacto, lo usa quien coordina la entrega) y todo el dinero.
--
-- El GRANT por columna sobre `pedidos` NO se toca: `authenticated` sigue sin poder
-- leer `nombre_cliente` de la tabla. Quien lo expone es la vista, que es propiedad
-- de `postgres` y lleva su propia condición de rol.

drop view if exists public.pedidos_admin;
drop view if exists public.pedidos_logistica;
drop view if exists public.pedidos_operaciones;

create view public.pedidos_operaciones as
select
  p.id, p.codigo, p.es_provincia, p.nombre_cliente,
  p.tipos_pedido, p.tipo_producto_terminado, p.cantidad,
  p.lugar_entrega, p.ubicacion_actual, p.estado, p.motivo,
  p.fecha_prometida, p.fecha_creacion, p.fecha_entrega, p.fecha_anulacion,
  p.detalle, p.observaciones, p.responsable_id,
  t.nombre  as responsable,
  d.nombre  as departamento,
  pr.nombre as provincia,
  -- El taller necesita saber si puede entregar, no cuánto se facturó.
  (btrim(coalesce(p.numero_factura, '')) <> '') as tiene_factura
from public.pedidos p
left join public.trabajadores     t  on t.id  = p.responsable_id
left join public.envios_provincia e  on e.pedido_id = p.id
left join public.departamentos    d  on d.id  = e.departamento_id
left join public.provincias       pr on pr.id = e.provincia_id
where public.auth_rol() is not null;

-- `nombre_cliente` ya llega por `o.*`: repetirlo aquí sería una columna duplicada.
create view public.pedidos_logistica as
select
  o.*,
  p.telefono_cliente, p.direccion_entrega, p.creado_por,
  e.nombre_agencia, e.nombre_persona_recoge, e.tipo_documento, e.numero_documento,
  e.telefono_persona_recoge, e.monto_flete, e.flete_pagado, e.observaciones_envio,
  -- Para escribir el envío hace falta el id, no el nombre del departamento.
  e.departamento_id, e.provincia_id
from public.pedidos_operaciones o
join public.pedidos p on p.id = o.id
left join public.envios_provincia e on e.pedido_id = p.id
where public.auth_rol() in ('administracion', 'logistica');

create view public.pedidos_admin as
select
  l.*,
  p.tipo_pago, p.plazo_credito_dias, p.monto_total, p.monto_pagado, p.saldo, p.pagado,
  p.numero_factura
from public.pedidos_logistica l
join public.pedidos p on p.id = l.id
where public.es_admin();

grant select on public.pedidos_operaciones, public.pedidos_logistica, public.pedidos_admin
  to authenticated;
