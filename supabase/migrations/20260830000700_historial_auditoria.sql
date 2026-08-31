-- Las dos formas de trazabilidad del sistema:
--   `historial_estados` — por dónde pasó el pedido. Se muestra a los tres roles.
--   `logs_auditoria`    — qué campo tocó quién. Inmutable, solo lo ve Administración.

create table public.historial_estados (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references public.pedidos (id) on delete cascade,
  estado     public.estado_pedido not null,
  -- El rol que tenía la persona en ese momento, no el que tenga hoy.
  rol        public.rol,
  motivo     text,
  usuario_id uuid references public.usuarios (id),
  creado_en  timestamptz not null default now()
);

create index historial_estados_pedido_idx on public.historial_estados (pedido_id, creado_en);

create table public.logs_auditoria (
  id             bigint generated always as identity primary key,
  pedido_id      uuid not null references public.pedidos (id) on delete cascade,
  usuario_id     uuid references public.usuarios (id),
  campo          text not null,
  valor_anterior text,
  valor_nuevo    text,
  creado_en      timestamptz not null default now()
);

create index logs_auditoria_pedido_idx on public.logs_auditoria (pedido_id, creado_en desc);

comment on table public.logs_auditoria is
  'Registro inmutable. Una fila por campo modificado. Sin políticas de UPDATE/DELETE y con el privilegio revocado.';

-- ── Cómo se lee un valor en el log ──────────────────────────────────────────
-- El log tiene que decir "Corte láser → Corte manual", no "CL → CM", y el nombre
-- del trabajador, no su uuid. Mismo criterio que `mostrar()` en web/lib/store.tsx.

create function public.etiqueta(valor text)
returns text
language sql
immutable
as $$
  select case valor
    when 'CL' then 'Corte láser'
    when 'CM' then 'Corte manual'
    when 'SP' then 'Solo planchas'
    when 'PT' then 'Productos terminados'
    when 'AC' then 'Accesorio'
    when 'cajas' then 'Cajas'
    when 'porta_afiches' then 'Porta afiches'
    when 'pivotante' then 'Pivotante'
    when 'letreros' then 'Letreros'
    when 'letras' then 'Letras'
    when 'displays' then 'Displays'
    when 'otro' then 'Otro'
    when 'registrado' then 'Registrado'
    when 'en_proceso' then 'En proceso'
    when 'observado' then 'Observado'
    when 'listo' then 'Listo'
    when 'en_transito' then 'En tránsito'
    when 'entregado' then 'Entregado'
    when 'anulado' then 'Anulado'
    when 'tienda' then 'En tienda'
    when 'taller' then 'En taller'
    when 'domicilio' then 'A domicilio'
    when 'agencia' then 'Agencia'
    when 'contado' then 'Al contado'
    when 'a_cuenta' then 'A cuenta'
    when 'credito' then 'Al crédito'
    when 'efectivo' then 'Efectivo'
    when 'yape_plin' then 'Yape / Plin'
    when 'transferencia' then 'Transferencia'
    when 'tarjeta' then 'Tarjeta'
    when 'DNI' then 'DNI'
    when 'CE' then 'Carné de extranjería'
    when 'diseno' then 'Diseño'
    when 'factura' then 'Factura'
    when 'guia' then 'Guía'
    when 'foto_entrega' then 'Foto de entrega'
    else valor
  end
$$;

create function public.auditoria_texto(campo text, valor jsonb)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when valor is null or valor = 'null'::jsonb or (valor #>> '{}') = '' then '—'
    when campo = 'tipos_pedido' then (
      select string_agg(public.etiqueta(t), ' · ')
      from jsonb_array_elements_text(valor) as t
    )
    when campo in ('responsable_id') then
      coalesce((select nombre from public.trabajadores where id = (valor #>> '{}')::uuid), '—')
    when campo = 'departamento' then
      coalesce((select nombre from public.departamentos where id = (valor #>> '{}')::smallint), '—')
    when campo = 'provincia' then
      coalesce((select nombre from public.provincias where id = (valor #>> '{}')::smallint), '—')
    when campo in ('monto_total', 'monto_pagado', 'monto_flete') then
      'S/ ' || to_char((valor #>> '{}')::numeric, 'FM999999990.00')
    when campo = 'flete_pagado' then
      case when (valor #>> '{}')::boolean then 'pagado' else 'por pagar' end
    when campo = 'plazo_credito_dias' then (valor #>> '{}') || ' días'
    else public.etiqueta(valor #>> '{}')
  end
$$;

-- ── Auditoría genérica ──────────────────────────────────────────────────────
-- Compara OLD contra NEW y emite una fila por columna cambiada. Las columnas a
-- vigilar y el pedido al que pertenecen llegan como argumentos del trigger, así
-- que la misma función sirve para `pedidos` y para `envios_provincia`.

create function public.auditar_cambios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  columnas  text[] := tg_argv[0]::text[];
  pedido    uuid;
  anterior  jsonb := to_jsonb(old);
  nuevo     jsonb := to_jsonb(new);
  columna   text;
  etiquetado text;
begin
  pedido := case tg_table_name when 'pedidos' then new.id else (nuevo ->> 'pedido_id')::uuid end;

  foreach columna in array columnas loop
    if (anterior -> columna) is distinct from (nuevo -> columna) then
      -- El log habla el vocabulario de la UI: "departamento", no "departamento_id".
      etiquetado := case columna
        when 'departamento_id' then 'departamento'
        when 'provincia_id'    then 'provincia'
        else columna
      end;

      insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo)
      values (
        pedido,
        auth.uid(),
        etiquetado,
        public.auditoria_texto(etiquetado, anterior -> columna),
        public.auditoria_texto(etiquetado, nuevo -> columna)
      );
    end if;
  end loop;

  return null;
end $$;

create trigger pedidos_auditoria
  after update on public.pedidos
  for each row execute function public.auditar_cambios(
    '{nombre_cliente,telefono_cliente,tipos_pedido,tipo_producto_terminado,cantidad,tipo_pago,
      plazo_credito_dias,monto_total,monto_pagado,lugar_entrega,direccion_entrega,ubicacion_actual,
      estado,motivo,fecha_prometida,detalle,observaciones,numero_factura,responsable_id}'
  );

create trigger envios_provincia_auditoria
  after update on public.envios_provincia
  for each row execute function public.auditar_cambios(
    '{departamento_id,provincia_id,nombre_agencia,nombre_persona_recoge,tipo_documento,
      numero_documento,telefono_persona_recoge,monto_flete,flete_pagado,observaciones_envio}'
  );

-- ── Historial de estados ────────────────────────────────────────────────────
-- Una fila al crear el pedido y una por cada cambio de estado. Nunca se escribe
-- a mano: la app solo lee esta tabla.

create function public.registrar_estado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.estado is not distinct from new.estado then
    return null;
  end if;

  insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id)
  values (new.id, new.estado, public.auth_rol(), new.motivo, auth.uid());

  return null;
end $$;

create trigger pedidos_historial
  after insert or update of estado on public.pedidos
  for each row execute function public.registrar_estado();
