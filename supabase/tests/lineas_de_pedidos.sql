-- Verificación de la migración 20261203000100: `lineas_de_pedidos(ids)`, las
-- líneas de varios pedidos de una vez para la lista.
--
--   npx supabase db query --linked -f supabase/tests/lineas_de_pedidos.sql
--
-- Necesita el seed (entra como `ana` y como `miguel`, y usa sus pedidos). Todo
-- dentro de una transacción que termina en ROLLBACK: no deja nada.

begin;

do $$
begin
  if not exists (select 1 from public.pedidos p join public.cotizaciones c on c.pedido_id = p.id) then
    raise exception 'No hay pedidos con líneas: hace falta el seed';
  end if;
  if has_function_privilege('anon', 'public.lineas_de_pedidos(uuid[])', 'execute') then
    raise exception 'FALLO: anon puede llamar a lineas_de_pedidos';
  end if;
end $$;

select set_config('plexi.ids',
                  (select array_agg(id)::text from public.pedidos),
                  true);

-- ── 1. Administración: lo mismo que el detalle, pedido por pedido, con precios ──

select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where usuario = 'ana'), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  ids     uuid[] := current_setting('plexi.ids')::uuid[];
  en_lote integer;
  uno     integer;
begin
  select count(*) into en_lote from public.lineas_de_pedidos(ids);
  select count(*) into uno
    from public.pedidos p, lateral public.lineas_de_pedido(p.codigo) l
   where p.id = any (ids);
  if en_lote = 0 or en_lote <> uno then
    raise exception 'FALLO: el lote trae % líneas y el detalle %', en_lote, uno;
  end if;

  if exists (
    select 1 from public.lineas_de_pedidos(ids) l
     where (l.tipo = 'corte' and (l.corte ->> 'total')::numeric = 0)
        or (l.tipo in ('corte', 'terminado') and l.importe is null)
  ) then
    raise exception 'FALLO: Administración no ve los precios de las líneas';
  end if;

  -- Cada línea dice de qué pedido es.
  if exists (
    select 1 from public.lineas_de_pedidos(ids) l
     where not exists (
       select 1 from public.lineas_de_pedido((select codigo from public.pedidos where id = l.pedido_id)) d
        where d.posicion = l.posicion and d.producto_nombre = l.producto_nombre
     )
  ) then
    raise exception 'FALLO: hay líneas colgadas del pedido equivocado';
  end if;
end $$;

-- ── 2. El taller: las mismas líneas, sin dinero ──────────────────────────────

select set_config('request.jwt.claims',
                  json_build_object('sub', (select id from public.usuarios where usuario = 'miguel'), 'role', 'authenticated')::text,
                  true);

do $$
declare
  ids uuid[] := current_setting('plexi.ids')::uuid[];
begin
  if not exists (select 1 from public.lineas_de_pedidos(ids)) then
    raise exception 'FALLO: el taller no ve las líneas de los pedidos';
  end if;
  if exists (
    select 1 from public.lineas_de_pedidos(ids) l
     where l.importe is not null or l.precio_unitario is not null
        or (l.corte ->> 'total')::numeric <> 0
        or (l.terminado ->> 'precioUnitario')::numeric <> 0
  ) then
    raise exception 'FALLO: el taller ve precios en la lista de pedidos';
  end if;
end $$;

-- ── 3. Sin perfil, nada ──────────────────────────────────────────────────────

select set_config('request.jwt.claims',
                  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
                  true);

do $$
begin
  if exists (select 1 from public.lineas_de_pedidos(current_setting('plexi.ids')::uuid[])) then
    raise exception 'FALLO: una sesión sin perfil ve líneas de pedidos';
  end if;
end $$;

set local role postgres;

select 'lineas_de_pedidos: todo en orden' as resultado;

rollback;
