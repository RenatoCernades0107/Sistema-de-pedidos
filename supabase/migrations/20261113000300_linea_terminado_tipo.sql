-- El tercer tipo de línea: un producto terminado.
--
-- Va solo en su migración: Postgres no deja usar un valor nuevo de un enum en la
-- misma transacción que lo crea, y la siguiente lo usa.

alter type public.tipo_linea add value if not exists 'terminado';
