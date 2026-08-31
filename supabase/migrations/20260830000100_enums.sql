-- Enums del dominio de Plexiacril.
--
-- Los valores son idénticos a los literales de `web/lib/dominio.ts`: la app ya
-- habla ese vocabulario, así que el tipo generado por Supabase encaja sin mapeo.

create type public.rol as enum (
  'administracion',
  'logistica',
  'operaciones'
);

-- Siglas, no nombres: son las que arma el código del pedido (dominio.ts:8).
create type public.tipo_pedido as enum (
  'CL',  -- corte láser
  'CM',  -- corte manual
  'SP',  -- solo planchas
  'PT',  -- productos terminados
  'AC'   -- accesorio
);

create type public.producto_terminado as enum (
  'cajas',
  'porta_afiches',
  'pivotante',
  'letreros',
  'letras',
  'displays',
  'otro'
);

create type public.estado_pedido as enum (
  'registrado',
  'en_proceso',
  'observado',
  'listo',
  'en_transito',
  'entregado',
  'anulado'
);

create type public.lugar_entrega as enum (
  'tienda',
  'taller',
  'domicilio',
  'agencia'
);

-- Dónde está el pedido ahora. No incluye 'domicilio': un pedido no "está" en el
-- domicilio del cliente, o se entregó o no.
create type public.ubicacion as enum (
  'tienda',
  'taller',
  'agencia'
);

create type public.tipo_pago as enum (
  'contado',
  'a_cuenta',
  'credito'
);

create type public.metodo_pago as enum (
  'efectivo',
  'yape_plin',
  'transferencia',
  'tarjeta',
  'otro'
);

create type public.tipo_adjunto as enum (
  'diseno',
  'factura',
  'guia',
  'foto_entrega'
);

create type public.tipo_documento as enum (
  'DNI',
  'CE'
);
