-- Verificación de la migración 20261216000100 (base de conocimiento y pruebas del
-- agente de WhatsApp), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/agente_whatsapp.sql
--
-- Entra como el primer usuario activo de Administración y después como uno de
-- Ventas. Todo dentro de una transacción que termina en ROLLBACK: no deja nada.

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
  doc uuid;
  v   extensions.vector(1536);
  r   record;
  n   integer;
begin
  -- 1. Administración crea un documento con dos fragmentos, uno con vector.
  insert into public.agente_documentos (nombre, tipo, mime, ruta, tamano, estado)
  values ('Catálogo prueba SQL', 'catalogo', 'application/pdf', 'prueba-sql/catalogo.pdf', 1234, 'listo')
  returning id into doc;

  v := (select ('[' || string_agg(case when i = 1 then '1' else '0' end, ',') || ']')::extensions.vector
          from generate_series(1, 1536) i);

  insert into public.agente_fragmentos (documento_id, orden, pagina, contenido, embedding, modelo_embedding)
  values (doc, 0, 1, 'Planchas de acrílico cristal de 3 mm, formato 1.22 x 2.44 m.', v, 'modelo-prueba'),
         (doc, 1, 2, 'Policarbonato alveolar para techos, protección UV.', null, null);

  -- 2. Por palabras: una pregunta con muchas palabras que no están igual encuentra el fragmento.
  select * into r from public.buscar_fragmentos_agente('¿tienen policarbonato para mi techo?') limit 1;
  if r.contenido not like 'Policarbonato%' then
    raise exception 'FALLO: la búsqueda por palabras no encontró el policarbonato: %', r.contenido;
  end if;

  -- 3. Por vector: con el mismo modelo encuentra el fragmento con vector aunque no comparta palabras.
  select count(*) into n from public.buscar_fragmentos_agente('zzz', v, 'modelo-prueba');
  if n <> 1 then
    raise exception 'FALLO: la búsqueda por vector devolvió % filas, se esperaba 1', n;
  end if;

  -- 4. Con otro modelo no se comparan vectores.
  select count(*) into n from public.buscar_fragmentos_agente('zzz', v, 'otro-modelo');
  if n <> 0 then
    raise exception 'FALLO: comparó vectores de modelos distintos';
  end if;

  -- 5. Un documento que no está listo no aparece.
  update public.agente_documentos set estado = 'procesando' where id = doc;
  select count(*) into n from public.buscar_fragmentos_agente('policarbonato');
  if n <> 0 then
    raise exception 'FALLO: aparecieron fragmentos de un documento sin procesar';
  end if;

  -- 6. Embedding y modelo van juntos.
  begin
    insert into public.agente_fragmentos (documento_id, orden, contenido, embedding)
    values (doc, 9, 'sin modelo', v);
    raise exception 'FALLO: aceptó un vector sin decir de qué modelo es';
  exception when check_violation then
    null;
  end;

  -- 7. Las conversaciones de prueba y sus mensajes.
  insert into public.agente_pruebas (titulo, anuncio) values ('Prueba SQL', '{"sourceId": "123"}');
  insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido)
  select id, 'cliente', 'Hola' from public.agente_pruebas where titulo = 'Prueba SQL';

  -- 8. Borrar el documento borra sus fragmentos.
  delete from public.agente_documentos where id = doc;
  if exists (select 1 from public.agente_fragmentos where documento_id = doc) then
    raise exception 'FALLO: quedaron fragmentos de un documento borrado';
  end if;
end $$;

-- 9. Ventas no toca la base de conocimiento (desde 20261221000100 sí atiende las
--    conversaciones y lee los documentos: ver agente_conversaciones.sql).
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('plexi.test_ventas'), 'role', 'authenticated')::text,
                  true)
 where current_setting('plexi.test_ventas') <> '';

do $$
begin
  if current_setting('plexi.test_ventas') = '' then
    raise notice 'Sin usuario de Ventas: se salta la prueba de permisos';
    return;
  end if;
  if exists (select 1 from public.agente_fragmentos) then
    raise exception 'FALLO: Ventas ve los fragmentos del agente';
  end if;
  begin
    insert into public.agente_documentos (nombre, tipo, mime, ruta, tamano)
    values ('x', 'otro', 'application/pdf', 'x/x.pdf', 1);
    raise exception 'FALLO: Ventas pudo crear un documento del agente';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select 'agente_whatsapp: OK' as resultado;

rollback;
