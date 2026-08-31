-- El historial de estados con el nombre de quien lo movió.
--
-- La tabla guarda `usuario_id`, y la RLS de `usuarios` solo deja a cada quien
-- leer su propia fila. Sin esta vista, el taller vería "Listo · (alguien)".
-- Ensanchar la política de `usuarios` resolvería lo mismo abriendo de paso los
-- correos de la empresa; una vista que expone solo el nombre, no.

create view public.historial_pedido as
select
  h.id,
  h.pedido_id,
  h.estado,
  h.rol,
  h.motivo,
  h.creado_en,
  u.nombre as usuario
from public.historial_estados h
left join public.usuarios u on u.id = h.usuario_id
where public.auth_rol() is not null;

grant select on public.historial_pedido to authenticated;

-- Mismo problema en la auditoría, que solo lee Administración.
create view public.auditoria_pedido as
select
  l.id,
  l.pedido_id,
  l.campo,
  l.valor_anterior,
  l.valor_nuevo,
  l.creado_en,
  u.nombre as usuario
from public.logs_auditoria l
left join public.usuarios u on u.id = l.usuario_id
where public.es_admin();

grant select on public.auditoria_pedido to authenticated;

-- Y en los abonos.
create view public.pagos_pedido as
select
  p.id,
  p.pedido_id,
  p.monto,
  p.metodo,
  p.fecha,
  u.nombre as usuario
from public.pagos p
left join public.usuarios u on u.id = p.registrado_por
where public.es_admin();

grant select on public.pagos_pedido to authenticated;
