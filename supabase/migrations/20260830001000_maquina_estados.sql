-- Máquina de estados del pedido y reglas de escritura por rol.

-- Las mismas transiciones que valida la UI en `transicionesValidas`
-- (web/lib/dominio.ts). Si las dos listas se separan, la app ofrece botones que
-- la base rechaza, así que esta función es el original y la de TypeScript la copia.
create function public.transiciones_validas(
  desde        public.estado_pedido,
  es_provincia boolean
)
returns public.estado_pedido[]
language sql
immutable
as $$
  select case desde
    when 'registrado'  then array['en_proceso', 'anulado']::public.estado_pedido[]
    when 'en_proceso'  then array['listo', 'observado', 'anulado']::public.estado_pedido[]
    when 'observado'   then array['en_proceso', 'anulado']::public.estado_pedido[]
    when 'listo'       then case
                              when es_provincia then array['en_transito', 'anulado']::public.estado_pedido[]
                              else array['entregado', 'anulado']::public.estado_pedido[]
                            end
    when 'en_transito' then array['entregado', 'anulado']::public.estado_pedido[]
    -- `entregado` y `anulado` son terminales: de ahí no se sale.
    else array[]::public.estado_pedido[]
  end
$$;

-- Valida el salto de estado y escribe la fecha de cierre que corresponda.
-- Las fechas las pone la base, no la app: son el dato con el que después se
-- discute si un pedido se entregó a tiempo.
create function public.validar_cambio_de_estado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    if not (new.estado = any (public.transiciones_validas(old.estado, old.es_provincia))) then
      raise exception 'Transición inválida en %: % → %', old.codigo, old.estado, new.estado;
    end if;
  end if;

  new.fecha_entrega   := case when new.estado = 'entregado' then coalesce(new.fecha_entrega, current_date) end;
  new.fecha_anulacion := case when new.estado = 'anulado'   then coalesce(new.fecha_anulacion, current_date) end;

  return new;
end $$;

create trigger pedidos_maquina_de_estados
  before insert or update on public.pedidos
  for each row execute function public.validar_cambio_de_estado();

-- ── Qué puede escribir cada rol ─────────────────────────────────────────────
--
-- Esto no cabe en una política de RLS: la RLS autoriza filas enteras y su
-- WITH CHECK no ve OLD, así que no puede expresar "Logística cambia el estado
-- pero no el monto". La comparación OLD/NEW solo existe en un trigger.
--
-- Espeja `ROLES` en web/lib/dominio.ts:
--   administracion  editarTodo
--   logistica       editarUbicacion + asignarResponsable + estado
--   operaciones     solo estado
create function public.validar_escritura_por_rol()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  rol_actual public.rol := public.auth_rol();
  -- Columnas que escribe la propia base: fechas de cierre, saldo y el total
  -- pagado que mantiene el trigger de `pagos`.
  derivadas text[] := array['actualizado_en', 'fecha_entrega', 'fecha_anulacion', 'saldo', 'pagado'];
  permitidas text[];
  cambiadas  text[];
  columna    text;
  anterior   jsonb := to_jsonb(old);
  nuevo      jsonb := to_jsonb(new);
begin
  -- Sin perfil no hay rol: es el service_role, una migración o el seed. La RLS ya
  -- decidió si esa sesión puede tocar la fila.
  if rol_actual is null or rol_actual = 'administracion' or public.escritura_del_sistema() then
    return new;
  end if;

  permitidas := case rol_actual
    when 'logistica'   then array['estado', 'motivo', 'ubicacion_actual', 'responsable_id']
    when 'operaciones' then array['estado', 'motivo']
    else array[]::text[]
  end || derivadas;

  cambiadas := '{}';
  foreach columna in array array(select jsonb_object_keys(nuevo)) loop
    if (anterior -> columna) is distinct from (nuevo -> columna)
       and not (columna = any (permitidas)) then
      cambiadas := cambiadas || columna;
    end if;
  end loop;

  if cardinality(cambiadas) > 0 then
    raise exception 'El rol % no puede modificar: %', rol_actual, array_to_string(cambiadas, ', ');
  end if;

  return new;
end $$;

create trigger pedidos_escritura_por_rol
  before update on public.pedidos
  for each row execute function public.validar_escritura_por_rol();
