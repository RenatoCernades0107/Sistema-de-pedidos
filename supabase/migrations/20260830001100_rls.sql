-- Permisos: quién ve qué filas (RLS) y quién ve qué columnas (GRANT + vistas).
--
-- La RLS de Postgres solo decide filas. Para las columnas hay dos piezas más:
--   1. GRANT SELECT por columna sobre `pedidos` a `authenticated`: ahí van solo las
--      columnas que el rol más restringido (Operaciones) puede ver. Nadie lee
--      `monto_total` ni `nombre_cliente` con la clave anónima del navegador.
--   2. Vistas propiedad de `postgres` que amplían ese conjunto y llevan su propia
--      condición de rol en el WHERE. Son SECURITY DEFINER a propósito: si fueran
--      `security_invoker` necesitarían el SELECT que acabamos de revocar.
--
-- La escritura la reparte el trigger `pedidos_escritura_por_rol`: los tres roles
-- comparten el rol Postgres `authenticated`, así que un GRANT no puede separarlos.

alter table public.usuarios           enable row level security;
alter table public.trabajadores       enable row level security;
alter table public.departamentos      enable row level security;
alter table public.provincias         enable row level security;
alter table public.pedidos            enable row level security;
alter table public.envios_provincia   enable row level security;
alter table public.pagos              enable row level security;
alter table public.historial_estados  enable row level security;
alter table public.logs_auditoria     enable row level security;
alter table public.adjuntos           enable row level security;

-- ── Catálogos: los lee cualquiera con sesión, los escribe Administración ──────

create policy catalogo_lectura on public.departamentos
  for select to authenticated using (public.auth_rol() is not null);

create policy catalogo_lectura on public.provincias
  for select to authenticated using (public.auth_rol() is not null);

create policy trabajadores_lectura on public.trabajadores
  for select to authenticated using (public.auth_rol() is not null);

create policy trabajadores_admin on public.trabajadores
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- ── Usuarios ─────────────────────────────────────────────────────────────────

create policy usuarios_propio on public.usuarios
  for select to authenticated using (id = auth.uid() or public.es_admin());

create policy usuarios_admin on public.usuarios
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- ── Pedidos ──────────────────────────────────────────────────────────────────
-- Row-wise los tres roles ven todos los pedidos; lo que cambia es el conjunto de
-- columnas. Crear y borrar son de Administración.

create policy pedidos_lectura on public.pedidos
  for select to authenticated using (public.auth_rol() is not null);

create policy pedidos_crear on public.pedidos
  for insert to authenticated with check (public.es_admin());

create policy pedidos_editar on public.pedidos
  for update to authenticated
  using (public.auth_rol() is not null)
  with check (public.auth_rol() is not null);

create policy pedidos_borrar on public.pedidos
  for delete to authenticated using (public.es_admin());

revoke all on public.pedidos from anon, authenticated;

-- Lo que ve Operaciones, que es el mínimo común: producción, sin cliente ni dinero.
grant select (
  id, codigo, es_provincia, tipos_pedido, tipo_producto_terminado, cantidad,
  lugar_entrega, ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion,
  fecha_entrega, fecha_anulacion, detalle, observaciones, responsable_id, actualizado_en
) on public.pedidos to authenticated;

-- El trigger decide qué puede tocar cada rol; el GRANT solo abre la puerta.
grant insert on public.pedidos to authenticated;
grant update (
  nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado, cantidad,
  tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, detalle, observaciones,
  numero_factura, responsable_id
) on public.pedidos to authenticated;
grant delete on public.pedidos to authenticated;

-- ── Envíos a provincia ───────────────────────────────────────────────────────
-- Operaciones solo necesita saber a qué departamento y provincia va la caja.

create policy envios_lectura on public.envios_provincia
  for select to authenticated using (public.auth_rol() is not null);

create policy envios_escritura on public.envios_provincia
  for all to authenticated
  using (public.auth_rol() in ('administracion', 'logistica'))
  with check (public.auth_rol() in ('administracion', 'logistica'));

revoke all on public.envios_provincia from anon, authenticated;
grant select (pedido_id, departamento_id, provincia_id) on public.envios_provincia to authenticated;
grant insert, update, delete on public.envios_provincia to authenticated;

-- ── Dinero y auditoría: solo Administración ──────────────────────────────────

create policy pagos_admin on public.pagos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy logs_lectura on public.logs_auditoria
  for select to authenticated using (public.es_admin());

-- Inmutabilidad de verdad: sin políticas de UPDATE/DELETE la RLS ya los bloquea,
-- y el REVOKE lo bloquea otra vez un nivel más abajo.
revoke insert, update, delete on public.logs_auditoria from anon, authenticated;

-- ── Historial de estados: lo ven los tres roles, no lo escribe nadie ──────────

create policy historial_lectura on public.historial_estados
  for select to authenticated using (public.auth_rol() is not null);

revoke insert, update, delete on public.historial_estados from anon, authenticated;

-- ── Adjuntos ─────────────────────────────────────────────────────────────────

create policy adjuntos_lectura on public.adjuntos
  for select to authenticated
  using (
    public.auth_rol() is not null
    and (public.auth_rol() <> 'operaciones' or tipo in ('diseno', 'foto_entrega'))
  );

create policy adjuntos_escritura on public.adjuntos
  for all to authenticated
  using (public.auth_rol() in ('administracion', 'logistica'))
  with check (public.auth_rol() in ('administracion', 'logistica'));

-- La marca de "escritura del sistema" desactiva el control de columnas por rol.
-- Si quedara expuesta por RPC, cualquiera con la clave anónima la encendería y
-- después se subiría el sueldo: solo la usan los triggers, que corren como
-- `postgres` y no necesitan el privilegio.
revoke execute on function public.marcar_escritura_del_sistema(boolean) from anon, authenticated;

-- ── Vistas por rol ───────────────────────────────────────────────────────────

-- Todo lo que ve el taller, con los nombres ya resueltos para no pedirle joins a
-- la app. Sin `nombre_cliente`: el taller produce sin saber de quién es el pedido.
create view public.pedidos_operaciones as
select
  p.id, p.codigo, p.es_provincia, p.tipos_pedido, p.tipo_producto_terminado, p.cantidad,
  p.lugar_entrega, p.ubicacion_actual, p.estado, p.motivo,
  p.fecha_prometida, p.fecha_creacion, p.fecha_entrega, p.fecha_anulacion,
  p.detalle, p.observaciones, p.responsable_id,
  t.nombre  as responsable,
  d.nombre  as departamento,
  pr.nombre as provincia
from public.pedidos p
left join public.trabajadores     t  on t.id  = p.responsable_id
left join public.envios_provincia e  on e.pedido_id = p.id
left join public.departamentos    d  on d.id  = e.departamento_id
left join public.provincias       pr on pr.id = e.provincia_id
where public.auth_rol() is not null;

-- Logística añade el cliente y el envío completo. Sigue sin ver dinero.
create view public.pedidos_logistica as
select
  o.*,
  p.nombre_cliente, p.telefono_cliente, p.direccion_entrega, p.creado_por,
  e.nombre_agencia, e.nombre_persona_recoge, e.tipo_documento, e.numero_documento,
  e.telefono_persona_recoge, e.monto_flete, e.flete_pagado, e.observaciones_envio
from public.pedidos_operaciones o
join public.pedidos p on p.id = o.id
left join public.envios_provincia e on e.pedido_id = p.id
where public.auth_rol() in ('administracion', 'logistica');

-- Administración ve además el dinero y la factura.
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

-- ── Storage ──────────────────────────────────────────────────────────────────
-- Convención de rutas, que la Fase 5 debe respetar:
--   pedidos/<pedido_id>/<tipo_adjunto>/<archivo>
-- El tercer segmento es lo que permite esconderle la factura al taller sin tener
-- que consultar la tabla `adjuntos` desde la política.

create policy adjuntos_storage_lectura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'adjuntos'
    and public.auth_rol() is not null
    and (
      public.auth_rol() <> 'operaciones'
      or (storage.foldername(name))[3] in ('diseno', 'foto_entrega')
    )
  );

create policy adjuntos_storage_escritura on storage.objects
  for all to authenticated
  using (bucket_id = 'adjuntos' and public.auth_rol() in ('administracion', 'logistica'))
  with check (bucket_id = 'adjuntos' and public.auth_rol() in ('administracion', 'logistica'));
