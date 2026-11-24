-- PC011 es de otra marca: Plaskolite, no NAC.
--
-- `20261110000100` lo sembró en "Policarbonato sólido NAC" (0.6 mm, 122×244). En
-- Odoo es policarbonato sólido Plaskolite. El grupo NAC de 0.6 mm solo tiene a
-- PC011, así que se renombra el grupo en vez de crear otro: los sobrantes y los
-- diseños que ya lo apuntan lo siguen. No se toca el stock.
--
-- Se busca por código, así que correrla dos veces no cambia nada.

do $$
declare
  v_grupo uuid;
  v_formatos integer;
begin
  select grupo_id into v_grupo
    from public.formatos_plancha
   where codigo_odoo = 'PC011';

  if v_grupo is null then
    return; -- ya no está: nada que mover
  end if;

  select count(*) into v_formatos
    from public.formatos_plancha
   where grupo_id = v_grupo;

  if v_formatos > 1 then
    raise exception 'El grupo de PC011 tiene % formatos; renombrarlo movería también a los otros', v_formatos;
  end if;

  update public.grupos_plancha
     set material = 'Policarbonato sólido Plaskolite'
   where id = v_grupo
     and material <> 'Policarbonato sólido Plaskolite';
end $$;
