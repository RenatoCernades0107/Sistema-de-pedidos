-- Verificación de la migración 20261204000100 (adjuntos del chat de diseños).
--
--   npx supabase db query --linked -f supabase/tests/cad_adjuntos.sql
--
-- Crea una persona de prueba y un diseño dentro de una transacción que termina
-- en ROLLBACK, así que no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'cad_adjuntos' and not public) then
    raise exception 'FALLO: falta el bucket privado cad_adjuntos';
  end if;
  if public.diseno_de_ruta_adjunto('6f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b/x.png')
     <> '6f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b'::uuid then
    raise exception 'FALLO: diseno_de_ruta_adjunto no lee la carpeta';
  end if;
  if public.diseno_de_ruta_adjunto('otra/cosa/x.png') is not null
     or public.diseno_de_ruta_adjunto('no-es-uuid/x.png') is not null then
    raise exception 'FALLO: diseno_de_ruta_adjunto acepta rutas de otra forma';
  end if;
end $$;

-- ── 2. Una persona con rol guarda un mensaje con adjuntos ───────────────────

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000d6a1', 'adj-ope@prueba.test',
   '{"nombre":"Olga Prueba","usuario":"adj-ope"}',
   '{"rol":"operaciones"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d6a1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno uuid;
begin
  insert into public.cad_disenos (nombre) values ('Caja con plano') returning id into v_diseno;

  insert into public.cad_mensajes (diseno_id, rol, contenido, adjuntos)
  values (v_diseno, 'usuario', '', jsonb_build_array(jsonb_build_object(
    'ruta', v_diseno || '/00000000-0000-4000-8000-000000000001.pdf',
    'nombre', 'plano.pdf', 'mime', 'application/pdf', 'tamano', 1234)));

  if (select jsonb_array_length(adjuntos) from public.cad_mensajes where diseno_id = v_diseno) <> 1 then
    raise exception 'FALLO: el mensaje no guardó sus adjuntos';
  end if;

  begin
    insert into public.cad_mensajes (diseno_id, rol, contenido, adjuntos)
    values (v_diseno, 'usuario', 'x', '{"ruta":"x"}'::jsonb);
    raise exception 'FALLO: adjuntos acepta algo que no es una lista';
  exception when check_violation then null;
  end;
end $$;

set local role postgres;

select 'cad adjuntos: todo en orden' as resultado;

rollback;
