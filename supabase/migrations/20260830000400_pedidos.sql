-- La tabla central: un pedido de Plexiacril.
--
-- Los nombres de columna son los que la app ya escribe en la auditoría
-- (el mapa COLUMNA de web/lib/store.tsx), y los tipos calcan la interfaz
-- `Pedido` de web/lib/dominio.ts.

-- Un CHECK no admite subconsultas, así que "sin elementos repetidos" tiene que
-- salir de una función.
create function public.array_sin_duplicados(a anyarray)
returns boolean
language sql
immutable
as $$
  select cardinality(a) = (select count(distinct x) from unnest(a) as x)
$$;

create table public.pedidos (
  id   uuid primary key default gen_random_uuid(),

  -- Lo que se dicta por teléfono y se escribe en la boleta. Lo genera el trigger
  -- del INSERT y después es inmutable.
  codigo text not null unique
    constraint pedidos_codigo_formato
    check (codigo ~ '^[LP](CL|CM|SP|PT|AC|MX)_[0-9]{4}_[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'),

  -- Se congela al crear: define la L/P del código, y el código no cambia nunca.
  es_provincia boolean not null,

  nombre_cliente   text not null check (btrim(nombre_cliente) <> ''),
  telefono_cliente text,

  -- Un pedido puede combinar trabajos: corte láser más accesorios, por ejemplo.
  tipos_pedido public.tipo_pedido[] not null
    check (cardinality(tipos_pedido) >= 1 and public.array_sin_duplicados(tipos_pedido)),

  -- Solo tiene sentido si el pedido incluye productos terminados, y entonces es
  -- obligatorio: sin esto se puede pedir "Cajas" en un pedido de solo planchas.
  tipo_producto_terminado public.producto_terminado
    check ((tipo_producto_terminado is not null) = ('PT' = any (tipos_pedido))),

  -- Media plancha se corta; media caja no existe.
  cantidad numeric(10, 2) not null
    check (cantidad > 0)
    check ('SP' = any (tipos_pedido) or cantidad = trunc(cantidad)),

  tipo_pago public.tipo_pago not null,

  -- Días de crédito que concede la empresa. No hay plazos a medida, y no hay
  -- plazo si el pedido no es al crédito.
  plazo_credito_dias smallint
    check (
      plazo_credito_dias is null
      or (tipo_pago = 'credito' and plazo_credito_dias in (1, 7, 15, 30, 90))
    ),

  monto_total  numeric(10, 2) not null default 0 check (monto_total >= 0),
  -- Lo mantiene el trigger de `pagos`. Nadie lo escribe a mano.
  monto_pagado numeric(10, 2) not null default 0
    check (monto_pagado >= 0 and monto_pagado <= monto_total),

  saldo  numeric(10, 2) generated always as (monto_total - monto_pagado) stored,
  pagado boolean        generated always as (monto_total - monto_pagado <= 0) stored,

  -- Un pedido a provincia se entrega en agencia, y solo esos.
  lugar_entrega public.lugar_entrega not null
    check ((lugar_entrega = 'agencia') = es_provincia),

  direccion_entrega text
    check (
      case
        when lugar_entrega = 'domicilio' then btrim(coalesce(direccion_entrega, '')) <> ''
        else direccion_entrega is null
      end
    ),

  ubicacion_actual public.ubicacion     not null default 'taller',
  estado           public.estado_pedido not null default 'registrado',

  -- Por qué se anuló o por qué está detenido. Un pedido observado sin explicación
  -- deja al taller adivinando.
  motivo text
    check (
      estado not in ('anulado', 'observado')
      or btrim(coalesce(motivo, '')) <> ''
    ),

  fecha_prometida date        not null,
  fecha_creacion  timestamptz not null default now(),

  -- Las dos fechas de cierre. Las escribe el trigger de estados, nunca la app, y
  -- son mutuamente excluyentes: un pedido se entrega o se anula.
  fecha_entrega   date check ((fecha_entrega   is not null) = (estado = 'entregado')),
  fecha_anulacion date check ((fecha_anulacion is not null) = (estado = 'anulado')),

  -- `detalle` es la especificación del trabajo (cantidad, material, marca, espesor,
  -- color, formato). `observaciones` son incidencias del pedido. No se mezclan.
  detalle       text not null default '',
  observaciones text,

  numero_factura text
    check (estado <> 'entregado' or btrim(coalesce(numero_factura, '')) <> ''),

  -- Quién hace el pedido en el taller. Puede no tener cuenta en la app.
  responsable_id uuid references public.trabajadores (id),
  creado_por     uuid references public.usuarios (id),

  actualizado_en timestamptz not null default now()
);

comment on column public.pedidos.monto_pagado is
  'Derivado de la tabla `pagos` por trigger. Escribirlo a mano lo desincroniza.';

-- Las seis vistas de la app filtran por estos campos en cada carga.
create index pedidos_estado_idx           on public.pedidos (estado);
create index pedidos_ubicacion_idx        on public.pedidos (ubicacion_actual);
create index pedidos_lugar_entrega_idx    on public.pedidos (lugar_entrega);
create index pedidos_fecha_prometida_idx  on public.pedidos (fecha_prometida);
create index pedidos_responsable_idx      on public.pedidos (responsable_id);
create index pedidos_provincia_idx        on public.pedidos (es_provincia) where es_provincia;
create index pedidos_tipos_idx            on public.pedidos using gin (tipos_pedido);

-- Un entregado o anulado desaparece de las vistas normales salvo que se haya
-- cerrado hoy; el resto vive en el historial (web/components/vista-pedidos.tsx).
create index pedidos_cierre_idx
  on public.pedidos (coalesce(fecha_entrega, fecha_anulacion) desc)
  where estado in ('entregado', 'anulado');

create function public.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

create trigger pedidos_actualizado_en
  before update on public.pedidos
  for each row execute function public.tocar_actualizado_en();
