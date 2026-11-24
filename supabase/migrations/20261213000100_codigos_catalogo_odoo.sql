-- PC011 es de otra marca: Plaskolite, no NAC.
--
-- `20261110000100` lo sembró en "Policarbonato sólido NAC" (0.6 mm, 122×244). En
-- Odoo es policarbonato sólido Plaskolite. No se toca el stock.
--
--   · Si ya existe el grupo "Policarbonato sólido Plaskolite" cristal 0.6 mm, PC011
--     pasa a él, con los sobrantes y diseños que apuntaban al grupo NAC; el grupo NAC
--     se borra si se queda vacío.
--   · Si no existe, se renombra el grupo NAC (solo tiene a PC011), y lo que lo
--     apuntaba lo sigue.
--
-- Se busca por código, así que correrla dos veces no cambia nada.

do $$
declare
  v_viejo uuid;
  v_nuevo uuid;
  v_formatos integer;
begin
  select grupo_id into v_viejo
    from public.formatos_plancha
   where codigo_odoo = 'PC011';

  if v_viejo is null then
    return; -- ya no está: nada que mover
  end if;

  select id into v_nuevo
    from public.grupos_plancha
   where material = 'Policarbonato sólido Plaskolite'
     and variante = 'Cristal'
     and detalle = ''
     and espesor_mm = 0.6;

  if v_nuevo is null then
    select count(*) into v_formatos
      from public.formatos_plancha
     where grupo_id = v_viejo;

    if v_formatos > 1 then
      raise exception 'El grupo de PC011 tiene % formatos; renombrarlo movería también a los otros', v_formatos;
    end if;

    update public.grupos_plancha
       set material = 'Policarbonato sólido Plaskolite'
     where id = v_viejo;

  elsif v_nuevo <> v_viejo then
    update public.formatos_plancha set grupo_id = v_nuevo where codigo_odoo = 'PC011';
    update public.sobrantes set grupo_id = v_nuevo where grupo_id = v_viejo;
    update public.cad_diseno_versiones set grupo_plancha_id = v_nuevo where grupo_plancha_id = v_viejo;

    if not exists (select 1 from public.formatos_plancha where grupo_id = v_viejo) then
      delete from public.grupos_plancha where id = v_viejo;
    end if;
  end if;
end $$;
