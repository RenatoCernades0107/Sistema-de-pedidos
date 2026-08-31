-- Archivos del pedido: diseños, factura, guía de remisión y foto de entrega.
--
-- Una tabla con `tipo`, no tres columnas de URL: un pedido llega con varios planos
-- y con más de una foto, y las columnas sueltas solo aguantan un archivo cada una.

create table public.adjuntos (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references public.pedidos (id) on delete cascade,
  tipo          public.tipo_adjunto not null,
  -- Ruta dentro del bucket privado. La URL firmada se pide al momento de mostrar.
  storage_path   text not null unique,
  nombre_archivo text not null,
  mime_type      text,
  tamano_bytes   bigint check (tamano_bytes is null or tamano_bytes >= 0),
  subido_por     uuid references public.usuarios (id),
  creado_en      timestamptz not null default now()
);

create index adjuntos_pedido_idx on public.adjuntos (pedido_id, tipo);

-- Bucket privado: nada de archivos de clientes servidos por URL pública adivinable.
insert into storage.buckets (id, name, public)
values ('adjuntos', 'adjuntos', false)
on conflict (id) do nothing;

-- Borrar un adjunto es irreversible, así que queda el rastro de quién lo borró:
-- el archivo se va, la fila del log no.
create function public.auditar_adjunto()
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
    insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo)
    values (old.pedido_id, auth.uid(), 'adjuntos', old.nombre_archivo, 'eliminado');
  end if;

  return null;
end $$;

create trigger adjuntos_auditoria
  after insert or delete on public.adjuntos
  for each row execute function public.auditar_adjunto();
