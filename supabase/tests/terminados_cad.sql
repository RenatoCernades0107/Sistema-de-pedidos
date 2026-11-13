-- Verificación de la migración 20261119000100 (productos terminados →
-- plantillas del motor CAD), contra el proyecto real.
--
--   npx supabase db query --linked -f supabase/tests/terminados_cad.sql
--
-- No necesita las cuentas del seed ni escribe nada que quede: termina en ROLLBACK.

begin;

do $$
declare
  p jsonb;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pt_productos'
                    and column_name = 'plantilla_cad' and data_type = 'text')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pt_productos'
                    and column_name = 'parametros_cad' and data_type = 'jsonb') then
    raise exception 'FALLO: faltan plantilla_cad o parametros_cad en pt_productos';
  end if;

  -- Los dos van juntos: plantilla sin parámetros (o al revés) no se acepta.
  begin
    update public.pt_productos set parametros_cad = null where codigo = 'CAJ-001';
    raise exception 'FALLO: se aceptó una plantilla sin parámetros';
  exception when check_violation then null;
  end;
  begin
    update public.pt_productos set parametros_cad = '[1]' where codigo = 'CAJ-001';
    raise exception 'FALLO: se aceptaron parámetros que no son un objeto';
  exception when check_violation then null;
  end;

  -- La caja de 20 × 15 × 10 cm y 3 mm va al motor en mm, con su tapa.
  select parametros_cad into p from public.pt_productos where codigo = 'CAJ-001' and plantilla_cad = 'caja';
  if p is null
     or (p ->> 'largo')::numeric <> 200 or (p ->> 'ancho')::numeric <> 150
     or (p ->> 'alto')::numeric <> 100 or (p ->> 'espesor')::numeric <> 3
     or (p ->> 'con_tapa')::boolean is not true then
    raise exception 'FALLO: parámetros de CAJ-001 inesperados: %', p;
  end if;

  select parametros_cad into p from public.pt_productos where codigo = 'DSP-002' and plantilla_cad = 'display';
  if p is null or (p ->> 'ancho')::numeric <> 200 or (p ->> 'fondo')::numeric <> 150 or (p ->> 'niveles')::int <> 3 then
    raise exception 'FALLO: parámetros de DSP-002 inesperados: %', p;
  end if;

  select parametros_cad into p from public.pt_productos where codigo = 'LET-001' and plantilla_cad = 'letras';
  if p is null or (p ->> 'alto_letra')::numeric <> 50 or p ? 'largo' then
    raise exception 'FALLO: parámetros de LET-001 inesperados: %', p;
  end if;

  -- Ninguna clave auxiliar del cálculo se quedó en la base.
  if exists (select 1 from public.pt_productos
              where parametros_cad ?| array['_m1', '_m2', '_m3', '_altura']) then
    raise exception 'FALLO: quedaron claves auxiliares en parametros_cad';
  end if;

  -- Lo que ninguna plantilla cubre sigue sin ella.
  if exists (select 1 from public.pt_productos
              where codigo in ('ANF-003', 'ANF-006', 'PAF-002') and plantilla_cad is not null) then
    raise exception 'FALLO: un producto sin plantilla quedó con una';
  end if;
  if (select count(*) from public.pt_productos where plantilla_cad is not null) < 20 then
    raise exception 'FALLO: muy pocos productos quedaron con plantilla';
  end if;
end $$;

select 'terminados_cad: todo en orden' as resultado;

rollback;
