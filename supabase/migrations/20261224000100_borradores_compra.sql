-- Borradores de "Nueva compra": el editor a medio llenar (proveedor, ítems,
-- documento, nota…) se guarda como borrador aunque esté incompleto y se retoma
-- desde la lista. Reutiliza la tabla `borradores` (RLS: solo los ve quien los
-- creó; vencen a las 48 h sin uso). No confundir con el estado `borrador` de
-- una compra ya guardada en `compras` (la pre-compra).
--
-- Solo cambia qué tipos admite la tabla. Idempotente.

alter table public.borradores drop constraint if exists borradores_tipo_check;

alter table public.borradores
  add constraint borradores_tipo_check check (tipo in ('pedido', 'cotizacion', 'compra'));

comment on table public.borradores is
  'Pedidos, cotizaciones y compras a medio llenar. Solo los ve quien los creó; vencen a las 48 h sin uso.';
