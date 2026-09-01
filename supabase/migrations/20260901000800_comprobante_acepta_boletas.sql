-- El negocio ahora emite boletas de venta, no solo facturas.
--
-- `numero_factura` guardaba el comprobante de la SUNAT, pero el único formato que
-- la app aceptaba era el de factura (`F001-004512`, en `lib/esquemas.ts`). Una
-- boleta (`B001-...`) se rechazaba en el formulario aunque la base la aceptara sin
-- chistar: aquí nunca hubo CHECK de formato, solo el de no-vacío al entregar.
--
-- Esta migración hace tres cosas:
--
--   1. Renombra la columna a `numero_comprobante`. El nombre viejo pasaría a mentir
--      en cuanto entre la primera boleta, y el nombre está incrustado en las vistas
--      de rol, el trigger de auditoría y toda la capa de TypeScript.
--
--   2. Nombra el CHECK de no-vacío. Estaba declarado inline, así que Postgres lo
--      autonombró `pedidos_check`. `lib/errores.ts` buscaba `pedidos_numero_factura_check`
--      para dar un mensaje amable, y ese nombre nunca existió: el error caía siempre
--      al genérico. Con nombre explícito el mapeo funciona.
--
--   3. Añade el CHECK de formato que faltaba. Hasta ahora el patrón vivía solo en
--      Zod, así que cualquier `insert` por SQL o por seed metía lo que quisiera. Se
--      sigue el precedente de `pedidos_codigo_formato` y `usuarios_usuario_formato`.
--
-- El tipo de comprobante (factura o boleta) NO se guarda en una columna: se deriva
-- del prefijo, que es la única fuente y no puede desincronizarse del número.
--
-- El tipo de adjunto `'factura'` del enum `tipo_adjunto` NO se toca. Es un tipo de
-- archivo, no el número, y su valor está incrustado en las rutas de Storage ya
-- subidas (`pedidos/<id>/factura/...`) y en dos policies de RLS.

-- ── 1. La columna ────────────────────────────────────────────────────────────
-- El CHECK y las vistas guardan la referencia por `attnum`, no por nombre, así que
-- el rename no los rompe. Tampoco pierde los GRANT por columna de `20260830001100`:
-- el `grant update (... numero_factura ...)` sigue vigente sobre la columna nueva.

alter table public.pedidos rename column numero_factura to numero_comprobante;

-- ── 2. Los CHECK ─────────────────────────────────────────────────────────────
-- El viejo es anónimo y su nombre autogenerado depende de cuántos CHECK de tabla
-- había al crearla, así que se busca por su definición en vez de adivinarlo.

do $$
declare
  anonimo text;
begin
  for anonimo in
    select conname
    from pg_constraint
    where conrelid = 'public.pedidos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%numero_comprobante%'
  loop
    execute format('alter table public.pedidos drop constraint %I', anonimo);
  end loop;
end $$;

alter table public.pedidos
  add constraint pedidos_comprobante_al_entregar
  check (estado <> 'entregado' or btrim(coalesce(numero_comprobante, '')) <> '');

-- Serie de 3 dígitos tras la letra, correlativo de hasta 8. `F` factura, `B` boleta.
alter table public.pedidos
  add constraint pedidos_comprobante_formato
  check (numero_comprobante is null or numero_comprobante ~ '^[FB][0-9]{3}-[0-9]{1,8}$');

-- ── 3. Las vistas de rol ─────────────────────────────────────────────────────
-- Copiadas de `20260901000400_operaciones_ve_al_cliente.sql`, que es su definición
-- vigente. Van completas porque `create or replace view` no puede renombrar una
-- columna en medio de una cadena de vistas, y estas tres están encadenadas:
-- `pedidos_admin` ⊃ `pedidos_logistica` ⊃ `pedidos_operaciones`.
--
-- Lo único que cambia respecto a la versión anterior es `tiene_factura` →
-- `tiene_comprobante` y `numero_factura` → `numero_comprobante`. El reparto por rol
-- es idéntico: el número crudo sigue saliendo solo en `pedidos_admin`.

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
  (btrim(coalesce(p.numero_comprobante, '')) <> '') as tiene_comprobante
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
  p.numero_comprobante
from public.pedidos_logistica l
join public.pedidos p on p.id = l.id
where public.es_admin();

grant select on public.pedidos_operaciones, public.pedidos_logistica, public.pedidos_admin
  to authenticated;

-- ── 4. El trigger de auditoría ───────────────────────────────────────────────
-- La lista de columnas auditadas viaja como literal de texto en `tg_argv[0]`, y eso
-- el rename no lo toca. Sin recrear el trigger, los cambios de comprobante dejarían
-- de registrarse en silencio: sin error, solo un hueco en el log.

drop trigger pedidos_auditoria on public.pedidos;

create trigger pedidos_auditoria
  after update on public.pedidos
  for each row execute function public.auditar_cambios(
    '{nombre_cliente,telefono_cliente,tipos_pedido,tipo_producto_terminado,cantidad,tipo_pago,
      plazo_credito_dias,monto_total,monto_pagado,lugar_entrega,direccion_entrega,ubicacion_actual,
      estado,motivo,fecha_prometida,detalle,observaciones,numero_comprobante,responsable_id}'
  );

-- ── 5. El historial ya escrito ───────────────────────────────────────────────
-- `logs_auditoria` guarda el nombre del campo como texto. Las filas viejas dicen
-- `numero_factura`, y la vista `auditoria_pedido` las muestra junto a las nuevas.
-- Quien lee ese historial es Administración, no un auditor forense: ver dos nombres
-- para el mismo campo confunde más de lo que informa.

update public.logs_auditoria
   set campo = 'numero_comprobante'
 where campo = 'numero_factura';
