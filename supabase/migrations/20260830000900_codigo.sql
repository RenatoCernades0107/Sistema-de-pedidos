-- El código del pedido: LCL_2026_H4TP.
--
--   {L|P}      local o a provincia
--   {sigla}    el tipo de trabajo, o MX si el pedido combina varios
--   {año}      año de registro
--   {4 chars}  aleatorios

-- Sin O/0 ni I/1: el código se dicta por teléfono y se lee de una boleta impresa.
create function public.sufijo_codigo()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    ''
  )
  from generate_series(1, 4)
$$;

-- Un pedido que combina trabajos es "MX": el código tiene que caber en una boleta,
-- así que no concatena siglas. El desglose real vive en `tipos_pedido`.
create function public.sigla_de(tipos public.tipo_pedido[])
returns text
language sql
immutable
as $$
  select case when cardinality(tipos) > 1 then 'MX' else tipos[1]::text end
$$;

create function public.generar_codigo_pedido(
  es_provincia boolean,
  tipos        public.tipo_pedido[],
  anio         integer default extract(year from now())::integer
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prefijo   text := case when es_provincia then 'P' else 'L' end || public.sigla_de(tipos);
  candidato text;
begin
  -- 32^4 ≈ 1M combinaciones por año, tipo y destino: la colisión es rara, pero
  -- "rara" no es "imposible" y el UNIQUE no perdona.
  for intento in 1 .. 10 loop
    candidato := prefijo || '_' || anio::text || '_' || public.sufijo_codigo();
    if not exists (select 1 from public.pedidos where codigo = candidato) then
      return candidato;
    end if;
  end loop;

  raise exception 'No se pudo generar un código único para % tras 10 intentos', prefijo;
end $$;

create function public.asignar_codigo_pedido()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.codigo is null then
    new.codigo := public.generar_codigo_pedido(
      new.es_provincia,
      new.tipos_pedido,
      extract(year from coalesce(new.fecha_creacion, now()))::integer
    );
  end if;

  return new;
end $$;

create trigger pedidos_asignar_codigo
  before insert on public.pedidos
  for each row execute function public.asignar_codigo_pedido();

-- El código ya está impreso en boletas y dictado por teléfono; `es_provincia` es
-- la letra que lo abre. Ninguno de los dos puede cambiar después del INSERT.
create function public.pedido_campos_inmutables()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'El código del pedido es inmutable (% → %)', old.codigo, new.codigo;
  end if;

  if new.es_provincia is distinct from old.es_provincia then
    raise exception 'El destino local/provincia del pedido % es inmutable', old.codigo;
  end if;

  if new.fecha_creacion is distinct from old.fecha_creacion then
    raise exception 'La fecha de creación del pedido % es inmutable', old.codigo;
  end if;

  return new;
end $$;

create trigger pedidos_inmutables
  before update on public.pedidos
  for each row execute function public.pedido_campos_inmutables();
