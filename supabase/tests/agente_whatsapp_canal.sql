-- Verificación de la migración 20261222000100 (agente de WhatsApp conectado a un
-- número real): las funciones del webhook, que entran sin sesión (anon) y solo
-- funcionan con la clave del agente.
--
--   npx supabase db query --linked -f supabase/tests/agente_whatsapp_canal.sql
--
-- Pone una clave de prueba en secretos_app dentro de la transacción. Todo termina
-- en ROLLBACK: no deja nada (ni la clave).

begin;

insert into public.secretos_app (nombre, valor) values ('agente_whatsapp', 'clave-de-prueba-sql-123')
on conflict (nombre) do update set valor = excluded.valor;

set local role anon;

do $$
declare
  r      record;
  conv   uuid;
  n      integer;
  ok     boolean;
begin
  -- 1. Sin la clave, nada.
  begin
    perform public.wa_contexto('otra-clave-cualquiera');
    raise exception 'FALLO: wa_contexto respondió sin la clave';
  exception when insufficient_privilege then
    null;
  end;

  -- 2. El primer mensaje abre la conversación, con su anuncio.
  select * into r from public.wa_recibir_mensaje(
    'clave-de-prueba-sql-123', 'PNID-SQL', '51999000111', 'Cliente SQL', 'wamid.sql.1', 'cliente',
    'Hola, quiero más información', null, '{"sourceId": "120", "titulo": "Acrílico"}', now());
  conv := r.conversacion_id;
  if r.estado <> 'agente' or r.duplicado then
    raise exception 'FALLO: la conversación no nació con el agente (% %)', r.estado, r.duplicado;
  end if;

  -- 3. El mismo wamid otra vez (Kapso reintenta): no se guarda dos veces.
  select * into r from public.wa_recibir_mensaje(
    'clave-de-prueba-sql-123', 'PNID-SQL', '51999000111', 'Cliente SQL', 'wamid.sql.1', 'cliente',
    'Hola, quiero más información', null, null, now());
  if not r.duplicado or r.conversacion_id <> conv then
    raise exception 'FALLO: un wamid repetido no se detectó';
  end if;

  -- 4. El historial lo ve con la clave.
  select count(*) into n from public.wa_historial('clave-de-prueba-sql-123', conv);
  if n <> 1 then
    raise exception 'FALLO: el historial tiene % mensajes, se esperaba 1', n;
  end if;

  -- 5. El agente deriva: queda en "necesita atención" y ya no puede responder.
  ok := public.wa_guardar_respuesta('clave-de-prueba-sql-123', conv, '', null, '[]', true, 'cotizar corte');
  if not ok then
    raise exception 'FALLO: no dejó guardar la respuesta del agente';
  end if;
  ok := public.wa_guardar_respuesta('clave-de-prueba-sql-123', conv, 'hola', null, '[]', false, null);
  if ok then
    raise exception 'FALLO: el agente respondió en una conversación que espera a un asesor';
  end if;

  -- 6. Un eco de la app del celular la deja "con un asesor".
  select * into r from public.wa_recibir_mensaje(
    'clave-de-prueba-sql-123', 'PNID-SQL', '51999000111', null, 'wamid.sql.2', 'asesor',
    'Te cotizo yo', null, null, now());
  if r.estado <> 'asesor' then
    raise exception 'FALLO: el eco de la app no pasó la conversación al asesor (%)', r.estado;
  end if;

  -- 7. El contexto y el catálogo se leen con la clave.
  if public.wa_contexto('clave-de-prueba-sql-123') ->> 'cuentas' is null
     or public.wa_catalogo('clave-de-prueba-sql-123') ->> 'grupos' is null then
    raise exception 'FALLO: wa_contexto o wa_catalogo no devolvieron sus listas';
  end if;

  -- 8. Pedir atención con la clave funciona; sin ella, no.
  perform public.wa_pedir_atencion('clave-de-prueba-sql-123', conv, 'no se pudo enviar');
  begin
    perform public.wa_pedir_atencion('otra-clave-cualquiera', conv, 'x');
    raise exception 'FALLO: wa_pedir_atencion funcionó sin la clave';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- 9. anon no lee las tablas directamente (RLS, o ni siquiera permiso sobre la tabla).
do $$
begin
  if exists (select 1 from public.agente_pruebas) then
    raise exception 'FALLO: anon lee las conversaciones sin pasar por las funciones';
  end if;
exception when insufficient_privilege then
  null;
end $$;

select 'agente_whatsapp_canal: OK' as resultado;

rollback;
