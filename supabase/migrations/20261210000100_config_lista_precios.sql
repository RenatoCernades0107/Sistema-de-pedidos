-- La lista de precios en PDF: Administración escribe en /configuracion los
-- teléfonos, la nota del pie y las notas de cada material (fila `lista_precios`
-- de `configuracion`). Logística también descarga la lista, pero no lee
-- `configuracion` (es solo de Administración): esta es su ventanilla.

create function public.config_lista_precios()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select valor from public.configuracion where clave = 'lista_precios'),
    '{}'::jsonb
  )
  where public.auth_rol() in ('administracion', 'logistica')
$$;

revoke execute on function public.config_lista_precios() from public, anon;
grant execute on function public.config_lista_precios() to authenticated;
