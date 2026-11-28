-- Verificación de la migración 20261225000100 (contornos vectoriales de los diseños).
--
--   npx supabase db query --linked -f supabase/tests/cad_contornos.sql
--
-- Crea una persona de prueba y un diseño dentro de una transacción que termina
-- en ROLLBACK, así que no deja nada.

begin;

-- ── 1. El esquema ───────────────────────────────────────────────────────────

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.cad_contornos'::regclass) then
    raise exception 'FALLO: cad_contornos sin RLS';
  end if;
  if has_table_privilege('anon', 'public.cad_contornos', 'select') then
    raise exception 'FALLO: anon lee cad_contornos';
  end if;
  if has_table_privilege('authenticated', 'public.cad_contornos', 'update')
     or has_table_privilege('authenticated', 'public.cad_contornos', 'delete') then
    raise exception 'FALLO: authenticated puede cambiar o borrar contornos (es solo inserción)';
  end if;
end $$;

-- ── 2. Una persona con rol guarda y lee un contorno ─────────────────────────

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000d6b1', 'cont-ope@prueba.test',
   '{"nombre":"Olga Prueba","usuario":"cont-ope"}',
   '{"rol":"operaciones"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d6b1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_diseno uuid;
begin
  insert into public.cad_disenos (nombre) values ('Logo Hurley') returning id into v_diseno;

  insert into public.cad_contornos (diseno_id, nombre, ancho_mm, alto_mm, trazos, origen)
  values (v_diseno, 'hurley', 3470, 830,
          '["M 0 0 L 10 0 L 10 10 Z"]'::jsonb,
          '{"adjunto":"plano.pdf","pagina":1}'::jsonb);

  if (select creado_por from public.cad_contornos where diseno_id = v_diseno and nombre = 'hurley')
     <> '00000000-0000-4000-8000-00000000d6b1'::uuid then
    raise exception 'FALLO: creado_por no es quien insertó';
  end if;

  -- El nombre no se repite dentro del diseño.
  begin
    insert into public.cad_contornos (diseno_id, nombre, ancho_mm, alto_mm, trazos)
    values (v_diseno, 'hurley', 1, 1, '["M 0 0 Z"]'::jsonb);
    raise exception 'FALLO: acepta dos contornos con el mismo nombre en un diseño';
  exception when unique_violation then null;
  end;

  -- Nombre, medidas y trazos inválidos.
  begin
    insert into public.cad_contornos (diseno_id, nombre, ancho_mm, alto_mm, trazos)
    values (v_diseno, 'Con Espacios', 1, 1, '["M 0 0 Z"]'::jsonb);
    raise exception 'FALLO: acepta un nombre con mayúsculas y espacios';
  exception when check_violation then null;
  end;
  begin
    insert into public.cad_contornos (diseno_id, nombre, ancho_mm, alto_mm, trazos)
    values (v_diseno, 'cero', 0, 1, '["M 0 0 Z"]'::jsonb);
    raise exception 'FALLO: acepta un ancho de 0';
  exception when check_violation then null;
  end;
  begin
    insert into public.cad_contornos (diseno_id, nombre, ancho_mm, alto_mm, trazos)
    values (v_diseno, 'sin_trazos', 1, 1, '[]'::jsonb);
    raise exception 'FALLO: acepta un contorno sin trazos';
  exception when check_violation then null;
  end;
  begin
    insert into public.cad_contornos (diseno_id, nombre, ancho_mm, alto_mm, trazos)
    values (v_diseno, 'objeto', 1, 1, '{"d":"M 0 0"}'::jsonb);
    raise exception 'FALLO: acepta trazos que no son una lista';
  exception when check_violation then null;
  end;

  -- Borrar el diseño se lleva sus contornos.
  set local role postgres;
  delete from public.cad_disenos where id = v_diseno;
  if exists (select 1 from public.cad_contornos where diseno_id = v_diseno) then
    raise exception 'FALLO: los contornos sobreviven al diseño';
  end if;
end $$;

-- ── 3. Sin sesión, nada ─────────────────────────────────────────────────────

select set_config('request.jwt.claims', '', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.cad_contornos) then
    raise exception 'FALLO: sin sesión se ven contornos';
  end if;
end $$;

set local role postgres;

select 'cad contornos: todo en orden' as resultado;

rollback;
