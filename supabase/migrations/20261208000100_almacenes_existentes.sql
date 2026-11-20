-- Los almacenes que ya existían en Odoo.
--
-- `20261205000100` sembró Andahuaylas (AND), Católica (CAT) y Esmeraldas (ESM)
-- pensando que la app los crearía en Odoo. Pero la empresa ya tenía en Odoo:
--   A1  Almacén Central     → es el que la app llama Católica (el taller)
--   A2  Almacén Andahuaylas → es el que la app llama Andahuaylas (la tienda)
--   A3  Almacen Chilca      → un almacén más, que faltaba en la app
-- Esmeraldas no existía: la app lo crea, y se queda con su código ESM.
--
-- La app encuentra el almacén de Odoo por su código (`asegurarAlmacen`). Basta
-- con poner el código real y soltar el enlace que se hubiera guardado hacia los
-- almacenes AND y CAT que la app creó por error: en la próxima petición se
-- vuelven a buscar por el código nuevo y se enlazan, sin crear nada.
--
-- Hay que archivar a mano, en Odoo, los almacenes AND y CAT que la app creó
-- (Inventario → Configuración → Almacenes), una vez comprobado que no tienen stock.

update public.almacenes
   set codigo = 'A2',
       odoo_warehouse_id = null,
       odoo_ubicacion_id = null,
       sincronizacion = 'pendiente',
       error_sincronizacion = null
 where codigo = 'AND';

update public.almacenes
   set codigo = 'A1',
       odoo_warehouse_id = null,
       odoo_ubicacion_id = null,
       sincronizacion = 'pendiente',
       error_sincronizacion = null
 where codigo = 'CAT';

insert into public.almacenes (nombre, codigo, tipo, orden)
values ('Chilca', 'A3', 'deposito', 4)
on conflict do nothing;
