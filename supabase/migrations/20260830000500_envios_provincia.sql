-- Datos del envío cuando el pedido va a provincia. 1:1 con `pedidos`.
--
-- Va en su propia tabla y no en columnas de `pedidos` porque la relación es
-- opcional: la mayoría de pedidos son locales y tendrían nueve columnas nulas.

create table public.envios_provincia (
  pedido_id uuid primary key references public.pedidos (id) on delete cascade,

  departamento_id smallint not null references public.departamentos (id),
  provincia_id    smallint,

  -- La FK compuesta es la que impide que una provincia del Cusco cuelgue del
  -- departamento de Piura. Una FK simple a `provincias(id)` no lo detectaría.
  constraint envios_provincia_pertenece_al_departamento
    foreign key (provincia_id, departamento_id)
    references public.provincias (id, departamento_id),

  nombre_agencia text,

  -- Quien retira el pedido en la agencia de destino.
  nombre_persona_recoge   text,
  tipo_documento          public.tipo_documento not null default 'DNI',
  numero_documento        text
    check (
      numero_documento is null
      or case tipo_documento
           when 'DNI' then numero_documento ~ '^[0-9]{8}$'
           when 'CE'  then numero_documento ~ '^[A-Za-z0-9]{9,12}$'
         end
    ),
  telefono_persona_recoge text,

  -- El costo del envío, distinto del monto del pedido.
  monto_flete  numeric(10, 2) not null default 0 check (monto_flete >= 0),
  flete_pagado boolean not null default false,

  -- Indicaciones para la agencia. Distinto de `pedidos.observaciones`.
  observaciones_envio text
);

create index envios_provincia_departamento_idx on public.envios_provincia (departamento_id);

-- El envío y la bandera del pedido no pueden contradecirse: si hay fila aquí, el
-- pedido es a provincia y se entrega en agencia.
create function public.validar_envio_provincia()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  pedido public.pedidos;
begin
  select * into pedido from public.pedidos where id = new.pedido_id;

  if not pedido.es_provincia then
    raise exception 'El pedido % no es a provincia: no puede tener datos de envío', pedido.codigo;
  end if;

  return new;
end $$;

create trigger envios_provincia_coherente
  before insert or update of pedido_id on public.envios_provincia
  for each row execute function public.validar_envio_provincia();
