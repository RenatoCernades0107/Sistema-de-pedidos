-- Las búsquedas de las referencias @ del chat (lib/chat/referencias-servidor.ts).
--
-- Los tres roles pueden referenciar clientes y pedidos, pero no leen lo mismo:
-- `cotizaciones` (el vínculo pedido → cliente de Odoo) es solo de Administración
-- y el teléfono del cliente no lo ve Operaciones. Estas funciones contestan lo
-- justo para el menú del @ —código, nombre, estado y fechas, nunca montos— y
-- esconden el teléfono a quien no lo puede ver, aunque deje buscar por él (es
-- como el taller ubica al cliente que llama).

-- ── Texto comparable ────────────────────────────────────────────────────────
-- Minúsculas y sin tildes, como `normalizar` de lib/busqueda.ts: "Pérez" = "perez".
-- Sin la extensión unaccent: con las letras del castellano basta.
create function public.chat_normalizar(p_texto text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(translate(coalesce(p_texto, ''), 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù', 'AEIOUUNaeiouunAEIOUaeiou'))
$$;

-- Solo letras y números: "P2611-001" y "p2611001" son el mismo código.
create function public.chat_compactar(p_texto text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(public.chat_normalizar(p_texto), '[^a-z0-9]', '', 'g')
$$;

-- Los últimos nueve dígitos: "+51 981 342 705" y "981342705" son el mismo celular.
create function public.chat_telefono(p_texto text)
returns text
language sql
immutable
parallel safe
as $$
  select right(regexp_replace(coalesce(p_texto, ''), '\D', '', 'g'), 9)
$$;

-- ── Pedidos de un cliente (@cliente X @pedido) ──────────────────────────────
-- Por el partner de Odoo (lo que dice la cotización del pedido) y, de respaldo,
-- por el nombre o el teléfono escritos en el pedido: los pedidos viejos y los
-- que no pasaron por una cotización solo tienen el texto.
create function public.pedidos_de_cliente(p_partner_id integer, p_nombre text, p_telefono text)
returns table (
  codigo          text,
  nombre_cliente  text,
  estado          public.estado_pedido,
  fecha_creacion  timestamptz,
  fecha_prometida date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.codigo, p.nombre_cliente, p.estado, p.fecha_creacion, p.fecha_prometida
    from public.pedidos p
   where public.auth_rol() is not null
     and (
       (p_partner_id is not null and exists (
          select 1 from public.cotizaciones c
           where c.pedido_id = p.id and c.odoo_partner_id = p_partner_id))
       or (btrim(coalesce(p_nombre, '')) <> ''
           and public.chat_normalizar(btrim(p.nombre_cliente)) = public.chat_normalizar(btrim(p_nombre)))
       -- Un teléfono a medias ("981") encontraría a medio Lima: siete dígitos o nada.
       or (length(public.chat_telefono(p_telefono)) >= 7
           and public.chat_telefono(p.telefono_cliente) = public.chat_telefono(p_telefono))
     )
   order by p.fecha_creacion desc
   limit 50
$$;

-- ── Buscar pedidos (@pedido P2611) ──────────────────────────────────────────
-- Por el código compactado o, si no, por las palabras del nombre del cliente.
-- Lo mismo que ya muestra `pedidos_operaciones` a los tres roles.
create function public.buscar_pedidos_chat(p_q text)
returns table (
  codigo          text,
  nombre_cliente  text,
  estado          public.estado_pedido,
  fecha_creacion  timestamptz,
  fecha_prometida date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select public.chat_compactar(p_q) as compacta,
           array_remove(regexp_split_to_array(public.chat_normalizar(btrim(coalesce(p_q, ''))), '[^a-z0-9]+'), '') as palabras
  )
  select p.codigo, p.nombre_cliente, p.estado, p.fecha_creacion, p.fecha_prometida
    from public.pedidos p, q
   where public.auth_rol() is not null
     and (
       q.compacta = ''
       or public.chat_compactar(p.codigo) like '%' || q.compacta || '%'
       or not exists (
         select 1 from unnest(q.palabras) w
          where public.chat_normalizar(p.nombre_cliente) not like '%' || w || '%')
     )
   order by
     (public.chat_compactar(p.codigo) = q.compacta) desc,
     (public.chat_compactar(p.codigo) like q.compacta || '%') desc,
     p.fecha_creacion desc
   limit 30
$$;

-- ── Clientes escritos en los pedidos (@cliente sin Odoo) ────────────────────
-- Un cliente por nombre (sin tildes ni mayúsculas), con su teléfono más reciente
-- solo para quien lo puede ver. Se busca por palabras del nombre o por dígitos
-- del teléfono; sin consulta, los de los pedidos más recientes.
create function public.clientes_de_pedidos(p_q text)
returns table (
  nombre   text,
  telefono text,
  pedidos  integer,
  ultimo   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select array_remove(regexp_split_to_array(public.chat_normalizar(btrim(coalesce(p_q, ''))), '[^a-z0-9]+'), '') as palabras,
           case when btrim(coalesce(p_q, '')) ~ '^[0-9 +().-]+$'
                then regexp_replace(p_q, '\D', '', 'g') else '' end as digitos
  ),
  coinciden as (
    select p.*, public.chat_normalizar(btrim(p.nombre_cliente)) as clave
      from public.pedidos p, q
     where public.auth_rol() is not null
       and btrim(p.nombre_cliente) <> ''
       and (
         cardinality(q.palabras) = 0
         or (length(q.digitos) >= 4
             and regexp_replace(coalesce(p.telefono_cliente, ''), '\D', '', 'g') like '%' || q.digitos || '%')
         or not exists (
           select 1 from unnest(q.palabras) w
            where public.chat_normalizar(p.nombre_cliente) not like '%' || w || '%')
       )
  )
  select
    (array_agg(btrim(c.nombre_cliente) order by c.fecha_creacion desc))[1],
    case when public.auth_rol() in ('administracion', 'logistica') then
      (array_agg(c.telefono_cliente order by c.fecha_creacion desc)
         filter (where btrim(coalesce(c.telefono_cliente, '')) <> ''))[1]
    end,
    count(*)::integer,
    max(c.fecha_creacion)
    from coinciden c
   group by c.clave
   order by max(c.fecha_creacion) desc
   limit 30
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.pedidos_de_cliente(integer, text, text)',
    'public.buscar_pedidos_chat(text)',
    'public.clientes_de_pedidos(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
