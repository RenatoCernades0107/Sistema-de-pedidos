do $$
begin
  raise notice 'usuarios=%  trabajadores=%  departamentos=%  provincias=%',
    (select count(*) from public.usuarios),
    (select count(*) from public.trabajadores),
    (select count(*) from public.departamentos),
    (select count(*) from public.provincias);
  raise notice 'pedidos=%  envios=%  pagos=%  adjuntos=%  historial=%  logs=%',
    (select count(*) from public.pedidos),
    (select count(*) from public.envios_provincia),
    (select count(*) from public.pagos),
    (select count(*) from public.adjuntos),
    (select count(*) from public.historial_estados),
    (select count(*) from public.logs_auditoria);
  raise notice 'restos de pruebas=%', (select count(*) from public.pedidos where nombre_cliente like 'Prueba %');
  raise notice 'estados=%', (select string_agg(e, ', ') from (select estado::text || ':' || count(*)::text as e from public.pedidos group by estado order by 1) s);
  raise notice 'saldos descuadrados=%', (select count(*) from public.pedidos p where p.monto_pagado <> coalesce((select sum(g.monto) from public.pagos g where g.pedido_id = p.id), 0));
end $$;

do $$
begin
  raise notice 'identidades de email=%', (select count(*) from auth.identities where provider = 'email');
  raise notice 'contrasena de ana valida=%',
    (select encrypted_password = extensions.crypt('plexi2026', encrypted_password)
     from auth.users where email = 'ana@plexiacril.test');
  raise notice 'roles=%', (select string_agg(rol::text || ':' || email, ', ' order by email) from public.usuarios);
end $$;
