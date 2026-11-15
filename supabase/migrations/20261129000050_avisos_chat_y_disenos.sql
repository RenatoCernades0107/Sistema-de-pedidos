-- Los avisos nuevos del chat y de los diseños 3D.
--
-- Va en su propio archivo porque un valor nuevo de un enum no se puede usar en la
-- misma transacción que lo agrega: las migraciones que siguen (el chat y las
-- versiones de los diseños) ya los encolan.
--
--   mencion           → alguien te nombró con @usuario en un chat que puedes leer.
--   mensaje_directo   → te escribieron por mensaje directo.
--   diseno_modificado → otra persona guardó una versión de un diseño tuyo.

alter type public.tipo_notificacion add value if not exists 'mencion';
alter type public.tipo_notificacion add value if not exists 'mensaje_directo';
alter type public.tipo_notificacion add value if not exists 'diseno_modificado';
