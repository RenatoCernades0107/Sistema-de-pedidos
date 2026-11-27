-- Verificación de la migración 20261221000100 (estado de las conversaciones del
-- agente, mensajes de asesores, adjuntos del cliente y permisos de Ventas).
--
--   npx supabase db query --linked -f supabase/tests/agente_conversaciones.sql
--
-- Entra como el primer usuario activo de Administración y luego como uno de Ventas
-- (si no hay, se salta esa parte). Todo termina en ROLLBACK: no deja nada.

begin;

select set_config('plexi.test_admin',
                  (select id::text from public.usuarios where rol = 'administracion' and activo
                    order by creado_en limit 1),
                  true);
select set_config('plexi.test_ventas',
                  coalesce((select id::text from public.usuarios where rol = 'ventas' and activo
                             order by creado_en limit 1), ''),
                  true);
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('plexi.test_admin'), 'role', 'authenticated')::text,
                  true);
set local role authenticated;

do $$
declare
  conv uuid;
begin
  -- 1. Una conversación nace con el agente.
  insert into public.agente_pruebas (titulo) values ('Prueba SQL conversaciones') returning id into conv;
  if (select estado from public.agente_pruebas where id = conv) <> 'agente' then
    raise exception 'FALLO: la conversación no nació con el agente';
  end if;
  perform set_config('plexi.test_conv', conv::text, true);

  -- 2. Pasa a un asesor con su motivo.
  update public.agente_pruebas
     set estado = 'necesita_atencion', motivo_atencion = 'cotizar corte', atencion_desde = now()
   where id = conv;

  -- 3. Un estado que no existe se rechaza.
  begin
    update public.agente_pruebas set estado = 'pausada' where id = conv;
    raise exception 'FALLO: aceptó un estado inventado';
  exception when check_violation then
    null;
  end;

  -- 4. Mensajes del cliente (con adjunto) y del asesor.
  insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido, adjuntos)
  values (conv, 'cliente', 'Mira esta foto', '[{"ruta": "x/y.jpg", "nombre": "y.jpg", "mime": "image/jpeg", "tamano": 10}]');
  insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido) values (conv, 'asesor', 'Te ayudo yo');
  if (select autor_id from public.agente_pruebas_mensajes where prueba_id = conv and rol = 'asesor')
     is distinct from current_setting('plexi.test_admin')::uuid then
    raise exception 'FALLO: el mensaje del asesor no guardó su autor';
  end if;

  -- 5. Rutas del bucket de adjuntos.
  if public.prueba_de_ruta_adjunto(conv::text || '/foto.jpg') is distinct from conv then
    raise exception 'FALLO: prueba_de_ruta_adjunto no leyó la conversación';
  end if;
  if public.prueba_de_ruta_adjunto('no-es-uuid/foto.jpg') is not null
     or public.prueba_de_ruta_adjunto(conv::text) is not null then
    raise exception 'FALLO: prueba_de_ruta_adjunto aceptó una ruta sin la forma';
  end if;
end $$;

-- 6. Ventas atiende: lee, responde como asesor y cambia el estado; no hace lo demás.
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('plexi.test_ventas'), 'role', 'authenticated')::text,
                  true)
 where current_setting('plexi.test_ventas') <> '';

do $$
declare
  conv uuid := current_setting('plexi.test_conv')::uuid;
  n    integer;
begin
  if current_setting('plexi.test_ventas') = '' then
    raise notice 'Sin usuario de Ventas: se salta la prueba de permisos';
    return;
  end if;

  if not exists (select 1 from public.agente_pruebas where id = conv) then
    raise exception 'FALLO: Ventas no ve la conversación';
  end if;

  insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido) values (conv, 'asesor', 'Soy de Ventas');
  update public.agente_pruebas set estado = 'asesor' where id = conv;
  if (select estado from public.agente_pruebas where id = conv) <> 'asesor' then
    raise exception 'FALLO: Ventas no pudo tomar la conversación';
  end if;

  begin
    insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido) values (conv, 'agente', 'suplantado');
    raise exception 'FALLO: Ventas escribió como el agente';
  exception when insufficient_privilege then
    null;
  end;

  delete from public.agente_pruebas where id = conv;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FALLO: Ventas borró una conversación';
  end if;

  begin
    insert into public.agente_documentos (nombre, tipo, mime, ruta, tamano)
    values ('x', 'otro', 'application/pdf', 'x/x.pdf', 1);
    raise exception 'FALLO: Ventas creó un documento del agente';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select 'agente_conversaciones: OK' as resultado;

rollback;
