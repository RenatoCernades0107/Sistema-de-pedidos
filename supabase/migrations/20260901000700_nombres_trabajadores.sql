-- Los trabajadores se llaman Isaac y John, no Issac ni Jhon.
--
-- Las dos erratas entraron en el catálogo de `20260830000200_catalogos.sql`, y de
-- ahí al proyecto que ya está en pie. Aquella migración ya lleva los nombres
-- corregidos, así que una base nueva nace bien y estos UPDATE no encuentran nada
-- que tocar; hacen falta igual para la base que ya existe, porque una migración
-- aplicada no se vuelve a correr.
--
-- Se renombran las filas, no se crean otras: `pedidos.responsable_id` apunta al
-- uuid, así que los pedidos ya asignados siguen apuntando a la misma persona.
update public.trabajadores set nombre = 'Isaac' where nombre = 'Issac';
update public.trabajadores set nombre = 'John'  where nombre = 'Jhon';
