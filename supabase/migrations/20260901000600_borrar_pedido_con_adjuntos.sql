-- Un pedido con archivos no se podía borrar.
--
-- `adjuntos.pedido_id` es `on delete cascade`, así que al borrar el pedido la
-- cascada borra sus adjuntos y eso dispara `adjuntos_auditoria`, que inserta una
-- fila en `logs_auditoria` apuntando al pedido… que ya no está. El INSERT choca
-- contra `logs_auditoria_pedido_id_fkey` y el DELETE entero se va abajo:
--
--   insert or update on table "logs_auditoria" violates foreign key constraint
--   "logs_auditoria_pedido_id_fkey"
--
-- Anotar ahí no serviría de nada aunque cupiera: `logs_auditoria` también es
-- `on delete cascade`, o sea que la fila se iría con el pedido en el mismo
-- comando. Así que cuando el pedido ya no existe, el borrado del adjunto no se
-- registra: no es un archivo que alguien quitó, es un pedido que se fue entero.
--
-- El caso de siempre —quitar un archivo de un pedido que sigue vivo— no cambia:
-- ahí el pedido está y la fila del log se escribe igual que antes.

create or replace function public.auditar_adjunto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo)
    values (new.pedido_id, auth.uid(), 'adjuntos', '—', new.nombre_archivo);
  else
    if not exists (select 1 from public.pedidos where id = old.pedido_id) then
      return null;
    end if;

    insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo)
    values (old.pedido_id, auth.uid(), 'adjuntos', old.nombre_archivo, 'eliminado');
  end if;

  return null;
end $$;
