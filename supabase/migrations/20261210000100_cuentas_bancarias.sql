-- Las cuentas bancarias de la empresa, que salen en el PDF de cada cotización
-- para que el cliente deposite.
--
-- Es el dato más jugoso del sistema para un estafador: quien cambie un número
-- recibe los pagos de todos los clientes. Por eso aquí nada funciona como el
-- resto de `/configuracion`:
--
--   1. Una cuenta no se edita nunca. Se agrega una nueva y se retira la vieja.
--      Una fila guardada no cambia de número ni de CCI: lo impide un trigger,
--      también para la clave de servicio y el editor SQL del panel.
--
--   2. Una cuenta nueva no sale en ningún PDF hasta 24 horas después de
--      agregada (`vigente_desde`, que pone un trigger, no quien escribe).
--      Todos los de Administración reciben un aviso de cada alta y cada retiro
--      (otro trigger), y cualquiera la puede retirar en esas 24 horas. Retirar
--      es inmediato: quitar una cuenta no le roba a nadie.
--
--   3. Nadie escribe la tabla directamente. Solo las dos funciones de abajo, y
--      esas exigen la clave del servidor (`LOGIN_SECRET`, como el login): el
--      servidor solo la presenta después de pedirle otra vez la contraseña a
--      quien hace el cambio. Una sesión robada (la cookie, el token) no basta
--      para meter una cuenta llamando a la API de Supabase por su cuenta.
--
--   4. Una cotización solo muestra cuentas que ya estaban vigentes el día que se
--      emitió. El PDF se arma cada vez que el cliente abre el enlace: sin esta
--      regla, una cuenta agregada hoy aparecería en las cotizaciones que ya se
--      mandaron la semana pasada.
--
--   5. Quién agregó y quién retiró cada cuenta, y cuándo, queda en la misma fila.

alter type public.tipo_notificacion add value if not exists 'cuenta_bancaria';

create table public.cuentas_bancarias (
  id uuid primary key default gen_random_uuid(),

  banco  text not null check (char_length(btrim(banco)) between 2 and 60),
  tipo   text not null check (tipo in ('corriente', 'ahorros', 'detracciones')),
  moneda text not null check (moneda in ('PEN', 'USD')),
  -- Como lo imprime el banco, con sus guiones: "191-1234567-0-12".
  numero text not null check (numero ~ '^[0-9][0-9-]{4,28}[0-9]$'),
  -- Los 20 dígitos del código interbancario. La cuenta de detracciones del Banco
  -- de la Nación no tiene: solo esa puede ir sin CCI.
  cci    text check (cci ~ '^[0-9]{20}$'),
  constraint cuentas_bancarias_cci_obligatorio check (cci is not null or tipo = 'detracciones'),

  creada_por    uuid not null references public.usuarios (id),
  creada_en     timestamptz not null default now(),
  -- Desde cuándo sale en los PDF. La pone `agregar_cuenta_bancaria`.
  vigente_desde timestamptz not null,

  retirada_por  uuid references public.usuarios (id),
  retirada_en   timestamptz,
  constraint cuentas_bancarias_retiro_completo check ((retirada_en is null) = (retirada_por is null))
);

comment on table public.cuentas_bancarias is
  'Cuentas para depósito que salen en el PDF de la cotización. Solo se agregan o se retiran, por funciones; nunca se editan.';

create index cuentas_bancarias_activas_idx on public.cuentas_bancarias (vigente_desde)
  where retirada_en is null;

-- ── Una fila guardada no cambia ─────────────────────────────────────────────
-- Lo único que se puede hacer con una cuenta es retirarla, una vez. Corre para
-- todos, también para `service_role` y `postgres`: si alguien entra al panel de
-- Supabase, cambiar un número exige quitar primero este trigger, y eso ya no es
-- un descuido.

create function public.cuentas_bancarias_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las cuentas bancarias no se borran: se retiran.';
  end if;

  if (new.id, new.banco, new.tipo, new.moneda, new.numero, new.cci,
      new.creada_por, new.creada_en, new.vigente_desde)
     is distinct from
     (old.id, old.banco, old.tipo, old.moneda, old.numero, old.cci,
      old.creada_por, old.creada_en, old.vigente_desde) then
    raise exception 'Una cuenta bancaria no se edita: agrega la correcta y retira esta.';
  end if;

  if old.retirada_en is not null then
    raise exception 'Esa cuenta ya estaba retirada.';
  end if;

  return new;
end;
$$;

create trigger cuentas_bancarias_inmutables
  before update or delete on public.cuentas_bancarias
  for each row execute function public.cuentas_bancarias_inmutables();

-- La espera de 24 horas la pone este trigger y no quien inserta: vale también
-- para un INSERT con la clave de servicio, que se salta la RLS y las funciones.
create function public.cuentas_bancarias_espera()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.creada_en     := now();
  new.vigente_desde := now() + interval '24 hours';
  new.retirada_en   := null;
  new.retirada_por  := null;
  return new;
end;
$$;

create trigger cuentas_bancarias_espera
  before insert on public.cuentas_bancarias
  for each row execute function public.cuentas_bancarias_espera();

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Administración las lee (para la pantalla). Nadie las escribe con su sesión:
-- solo las funciones de abajo.

alter table public.cuentas_bancarias enable row level security;

revoke all on public.cuentas_bancarias from public, anon, authenticated;
grant select on public.cuentas_bancarias to authenticated;

create policy cuentas_bancarias_admin_lee on public.cuentas_bancarias
  for select to authenticated using (public.es_admin());

-- ── El aviso a Administración ───────────────────────────────────────────────
-- Con un trigger, no desde las funciones: así avisa de cualquier alta o retiro,
-- venga de la app, de la clave de servicio o del editor SQL del panel.
-- Va a todos los de Administración, también a quien hizo el cambio: si su
-- cuenta está en manos de otro, es la única forma de que se entere.
-- Los últimos 4 dígitos bastan para reconocer la cuenta sin repartir el número
-- completo por notificaciones.

create function public.avisar_cuenta_bancaria()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quien  text;
  v_cuenta text;
  v_titulo text;
  v_cuerpo text;
begin
  select nombre into v_quien from public.usuarios where id = auth.uid();
  v_quien := coalesce(v_quien, 'Alguien fuera de la app');
  v_cuenta := new.banco || ' · ' || case new.moneda when 'PEN' then 'soles' else 'dólares' end
              || ' · ****' || right(regexp_replace(new.numero, '[^0-9]', '', 'g'), 4);

  if tg_op = 'INSERT' then
    v_titulo := 'Nueva cuenta bancaria: ' || v_cuenta;
    v_cuerpo := v_quien || ' la agregó. Saldrá en las cotizaciones desde el '
             || to_char(new.vigente_desde at time zone 'America/Lima', 'DD/MM HH24:MI')
             || '. Si no la reconoces, retírala ya en Configuración y cambia las contraseñas.';
  elsif old.retirada_en is null and new.retirada_en is not null then
    v_titulo := 'Cuenta bancaria retirada: ' || v_cuenta;
    v_cuerpo := v_quien || ' la retiró. Ya no sale en las cotizaciones.';
  else
    return null;
  end if;

  insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, url)
  select u.id, 'cuenta_bancaria'::text::public.tipo_notificacion, v_titulo, v_cuerpo, '/configuracion?tab=cuentas'
  from public.usuarios u
  where u.rol = 'administracion' and u.activo;

  return null;
end;
$$;

revoke execute on function public.avisar_cuenta_bancaria() from public, anon, authenticated;

create trigger cuentas_bancarias_aviso
  after insert or update on public.cuentas_bancarias
  for each row execute function public.avisar_cuenta_bancaria();

-- ── Agregar ─────────────────────────────────────────────────────────────────

create function public.agregar_cuenta_bancaria(
  p_banco  text,
  p_tipo   text,
  p_moneda text,
  p_numero text,
  p_cci    text,
  clave    text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.clave_de_login_valida(clave) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not public.es_admin() then
    raise exception 'Solo Administración maneja las cuentas bancarias.' using errcode = '42501';
  end if;

  -- `vigente_desde` lo pisa el trigger `cuentas_bancarias_espera`.
  insert into public.cuentas_bancarias (banco, tipo, moneda, numero, cci, creada_por, vigente_desde)
  values (btrim(p_banco), p_tipo, p_moneda, btrim(p_numero), nullif(btrim(p_cci), ''), auth.uid(), now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.agregar_cuenta_bancaria(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.agregar_cuenta_bancaria(text, text, text, text, text, text)
  to authenticated;

-- ── Retirar ─────────────────────────────────────────────────────────────────
-- También exige la clave: así el aviso de "X retiró la cuenta" siempre es de
-- alguien que volvió a escribir su contraseña.

create function public.retirar_cuenta_bancaria(p_id uuid, clave text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.clave_de_login_valida(clave) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not public.es_admin() then
    raise exception 'Solo Administración maneja las cuentas bancarias.' using errcode = '42501';
  end if;

  update public.cuentas_bancarias
     set retirada_en = now(), retirada_por = auth.uid()
   where id = p_id and retirada_en is null;

  if not found then
    raise exception 'Esa cuenta no existe o ya estaba retirada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.retirar_cuenta_bancaria(uuid, text) from public, anon;
grant execute on function public.retirar_cuenta_bancaria(uuid, text) to authenticated;

-- ── El PDF público ──────────────────────────────────────────────────────────
-- Las cuentas viajan dentro de `cotizacion_publica()`, como los días de
-- validez: el cliente no tiene sesión. Solo las vigentes hoy que ya lo eran
-- cuando se emitió la cotización (punto 4 de arriba).
-- Misma firma y mismo retorno: `create or replace` conserva los grants.

create or replace function public.cotizacion_publica(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'canal', c.canal,
    'odoo_partner_id', c.odoo_partner_id,
    'cliente_nombre', c.cliente_nombre,
    'cliente_documento', c.cliente_documento,
    'cliente_telefono', null,
    'odoo_order_id', c.odoo_order_id,
    'odoo_order_name', c.odoo_order_name,
    'sincronizacion', c.sincronizacion,
    'error_sincronizacion', null,
    'monto_sin_impuestos', c.monto_sin_impuestos,
    'monto_impuestos', c.monto_impuestos,
    'monto_total', c.monto_total,
    'notas', null,
    'chat_agente_id', null,
    'creado_en', c.creado_en,
    'confirmada_en_odoo', c.confirmada_en_odoo,
    'error_confirmacion', null,
    'creador', null,
    'pedido', null,
    -- Lo que Administración puso en /configuracion; 15 si nunca lo tocó. El
    -- mismo defecto que `VALIDEZ_POR_DEFECTO` en lib/cotizaciones-config.ts.
    'validez_dias', coalesce(
      (select case when jsonb_typeof(cfg.valor -> 'validezDias') = 'number'
                   then (cfg.valor ->> 'validezDias')::numeric::int end
         from public.configuracion cfg
        where cfg.clave = 'cotizaciones'),
      15
    ),
    'cuentas_bancarias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'banco', cb.banco,
        'tipo', cb.tipo,
        'moneda', cb.moneda,
        'numero', cb.numero,
        'cci', cb.cci
      ) order by cb.moneda, cb.banco, cb.creada_en)
      from public.cuentas_bancarias cb
      where cb.retirada_en is null
        and cb.vigente_desde <= now()
        and cb.vigente_desde <= c.creado_en
    ), '[]'::jsonb),
    'cotizacion_productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'posicion', cp.posicion,
        'odoo_product_id', cp.odoo_product_id,
        'producto_nombre', cp.producto_nombre,
        'producto_codigo', cp.producto_codigo,
        'descripcion', cp.descripcion,
        'cantidad', cp.cantidad,
        'precio_unitario', cp.precio_unitario,
        'tipo', cp.tipo,
        'corte', cp.corte,
        'terminado', cp.terminado,
        'importe', cp.importe,
        'odoo_produccion_id', null
      ) order by cp.posicion)
      from public.cotizacion_productos cp
      where cp.cotizacion_id = c.id
    ), '[]'::jsonb)
  )
  from public.cotizaciones c
  where c.token_publico = p_token
$$;
