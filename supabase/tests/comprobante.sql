-- Verificación de la migración 20260901000800, contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/comprobante.sql
--
-- A diferencia de `asserts.sql`, esta no necesita las tres cuentas del seed ni
-- cambia de rol: sirve en un proyecto de producción con sus usuarios de verdad.
-- Comprueba el esquema y luego prueba el CHECK sobre un pedido de mentira que
-- nace y muere dentro de la transacción. Termina en ROLLBACK: no deja nada.
--
-- Lo que NO cubre, por necesitar sesiones de rol: que Operaciones y Logística
-- sigan sin poder leer ni escribir el número. Eso vive en `asserts.sql`.

begin;

-- ── 1. Los dos CHECK, con nombre propio ─────────────────────────────────────
-- El viejo era anónimo y `lib/errores.ts` nunca pudo emparejarlo.

do $$
declare
  faltan text;
begin
  select string_agg(c, ', ')
    into faltan
    from unnest(array['pedidos_comprobante_al_entregar', 'pedidos_comprobante_formato']) as c
   where not exists (
     select 1 from pg_constraint
      where conrelid = 'public.pedidos'::regclass and conname = c
   );

  if faltan is not null then
    raise exception 'FALLO: no existe el CHECK %', faltan;
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.pedidos'::regclass
       and contype = 'c'
       and conname not in ('pedidos_comprobante_al_entregar', 'pedidos_comprobante_formato')
       and pg_get_constraintdef(oid) like '%numero_comprobante%'
  ) then
    raise exception 'FALLO: quedó un CHECK anónimo sobre el comprobante';
  end if;
end $$;

-- ── 2. La columna se llama como debe ────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pedidos'
       and column_name = 'numero_comprobante'
  ) then
    raise exception 'FALLO: pedidos.numero_comprobante no existe';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pedidos'
       and column_name = 'numero_factura'
  ) then
    raise exception 'FALLO: pedidos.numero_factura sigue ahí';
  end if;
end $$;

-- ── 3. El reparto por rol de las vistas ─────────────────────────────────────
-- El booleano en las tres; el número, solo en la de Administración. Esta es la
-- regla de negocio de verdad: el taller no ve el comprobante.

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and column_name = 'tiene_comprobante'
         and table_name in ('pedidos_operaciones', 'pedidos_logistica', 'pedidos_admin')) <> 3 then
    raise exception 'FALLO: tiene_comprobante no está en las tres vistas de rol';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and column_name = 'numero_comprobante'
                and table_name in ('pedidos_operaciones', 'pedidos_logistica')) then
    raise exception 'FALLO: el comprobante se filtró a una vista que no debe verlo';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and column_name = 'numero_comprobante'
                    and table_name = 'pedidos_admin') then
    raise exception 'FALLO: Administración perdió el número de comprobante';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and column_name in ('numero_factura', 'tiene_factura')
                and table_name like 'pedidos_%') then
    raise exception 'FALLO: alguna vista sigue exponiendo el nombre viejo';
  end if;
end $$;

-- ── 4. El trigger de auditoría ──────────────────────────────────────────────
-- Su lista de columnas es un literal de texto, así que el rename de la columna
-- no la toca: si el trigger no se recreó, los cambios de comprobante dejan de
-- registrarse sin dar ningún error.

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.pedidos'::regclass
       and tgname = 'pedidos_auditoria'
       and pg_get_triggerdef(oid) like '%numero_comprobante%'
  ) then
    raise exception 'FALLO: pedidos_auditoria no audita numero_comprobante';
  end if;
end $$;

-- ── 5. El CHECK de formato, en caliente ─────────────────────────────────────
-- Sobre un pedido propio, no sobre uno real. Nace y muere en la transacción.

do $$
declare
  pedido uuid;
  valor  text;
begin
  insert into public.pedidos (es_provincia, nombre_cliente, tipos_pedido, cantidad,
                              tipo_pago, monto_total, lugar_entrega, fecha_prometida)
  values (false, 'Prueba comprobante', array['CL']::public.tipo_pedido[], 1,
          'contado', 100, 'tienda', current_date + 3)
  returning id into pedido;

  foreach valor in array array[
    'F001-004512', 'B001-000318', 'F010-1', 'B999-00004512',
    'P001-004512', 'NV001-004512', 'NV010-1'
  ] loop
    begin
      update public.pedidos set numero_comprobante = valor where id = pedido;
    exception when others then
      raise exception 'FALLO: se rechazó el comprobante válido %', valor;
    end;
  end loop;

  foreach valor in array array[
    'FF01-004512',      -- serie con letra
    'X001-004512',      -- ni factura, boleta, proforma ni nota de venta
    'f001-004512',      -- minúscula
    'F001-000045123',   -- correlativo de 9
    'F001-',            -- sin correlativo
    'F0011-004512',     -- serie de 4
    'N001-004512',      -- 'N' sola no es nota de venta
    'NV0011-004512'     -- serie de 4 en nota de venta
  ] loop
    begin
      update public.pedidos set numero_comprobante = valor where id = pedido;
      raise exception 'FALLO: se aceptó el comprobante inválido %', valor;
    exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;
  end loop;

  -- Y sin comprobante no se entrega, que es la regla que sostiene todo esto.
  update public.pedidos set numero_comprobante = null, estado = 'en_proceso' where id = pedido;
  update public.pedidos set estado = 'listo' where id = pedido;

  begin
    update public.pedidos set estado = 'entregado' where id = pedido;
    raise exception 'FALLO: se entregó un pedido sin comprobante';
  exception when others then if sqlerrm like 'FALLO:%' then raise; end if; end;

  -- Con boleta sí, y el booleano de las vistas lo refleja.
  update public.pedidos set estado = 'entregado', numero_comprobante = 'B001-000318' where id = pedido;

  if not (select tiene_comprobante from public.pedidos_admin where id = pedido) then
    raise exception 'FALLO: tiene_comprobante sigue en falso con la boleta puesta';
  end if;
end $$;

-- ── 6. El historial viejo ───────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from public.logs_auditoria where campo = 'numero_factura') then
    raise exception 'FALLO: quedaron filas de auditoría con el nombre viejo';
  end if;
end $$;

select 'Verificación del comprobante: todo en orden.' as resultado;

rollback;
