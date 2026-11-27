-- El agente de WhatsApp conectado a un número real (vía Kapso).
--
-- El webhook (`/api/whatsapp/webhook`) llega sin sesión de nadie y la app no tiene
-- clave de servicio a propósito. Así que todo lo que necesita pasa por funciones
-- SECURITY DEFINER acotadas que exigen un secreto del servidor, como el login
-- (`clave_de_login_valida`): la fila `agente_whatsapp` de `secretos_app`, que el
-- servidor de Next conoce como AGENTE_WA_SECRETO. Con la clave publicable sola,
-- estas funciones no hacen nada.
--
-- Las conversaciones de WhatsApp viven en la misma tabla que las de prueba
-- (`agente_pruebas`, con `canal = 'whatsapp'`): así /conversaciones las muestra
-- juntas y el agente las trata igual.

/* ── Conversaciones de WhatsApp ──────────────────────────────────────────────── */

alter table public.agente_pruebas
  add column canal text not null default 'prueba' check (canal in ('prueba', 'whatsapp')),
  -- El número del cliente (o su id de WhatsApp si no muestra el número).
  add column telefono text,
  add column contacto_nombre text,
  -- El número de la empresa que recibió el mensaje (Meta phone_number_id).
  add column phone_number_id text,
  add constraint agente_pruebas_whatsapp_completa
    check (canal = 'prueba' or (telefono is not null and phone_number_id is not null));

-- Las abre el webhook, que no es nadie.
alter table public.agente_pruebas alter column creado_por drop not null;

create unique index agente_pruebas_whatsapp_idx
  on public.agente_pruebas (phone_number_id, telefono) where canal = 'whatsapp';

-- El id de WhatsApp del mensaje (wamid): Kapso puede reintentar un webhook, y el
-- mismo mensaje no se guarda (ni se responde) dos veces.
alter table public.agente_pruebas_mensajes add column wamid text;
create unique index agente_pruebas_mensajes_wamid_idx
  on public.agente_pruebas_mensajes (wamid) where wamid is not null;

comment on column public.agente_pruebas.canal is
  'prueba: el área de pruebas de /agente-whatsapp. whatsapp: un cliente real, por el webhook de Kapso.';

/* ── El secreto ──────────────────────────────────────────────────────────────── */

create function public.clave_agente_valida(p_clave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.valor = p_clave from public.secretos_app s where s.nombre = 'agente_whatsapp'),
    false)
$$;

revoke execute on function public.clave_agente_valida(text) from public, anon, authenticated;

create function public.exigir_clave_agente(p_clave text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.clave_agente_valida(p_clave) then
    raise exception 'AGENTE_NO_AUTORIZADO: clave del agente inválida' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.exigir_clave_agente(text) from public, anon, authenticated;

/* ── Recibir un mensaje ──────────────────────────────────────────────────────── */

-- Guarda un mensaje que llegó por WhatsApp: del cliente, o (`asesor`) uno que
-- alguien del equipo mandó desde la app de WhatsApp Business del celular. Abre la
-- conversación si es la primera vez y mueve su estado:
--   cliente → una resuelta vuelve al agente; las demás siguen con quien estaban.
--   asesor  → pasa a "con un asesor": el agente no le escribe encima.
-- Si el wamid ya estaba, no hace nada y devuelve `duplicado`. Devuelve también el
-- anuncio de la conversación: Meta lo manda solo con el primer mensaje.
create function public.wa_recibir_mensaje(
  p_clave           text,
  p_phone_number_id text,
  p_telefono        text,
  p_contacto        text,
  p_wamid           text,
  p_rol             text,
  p_contenido       text,
  p_adjuntos        jsonb,
  p_anuncio         jsonb,
  p_creado_en       timestamptz default now()
)
returns table (conversacion_id uuid, estado text, duplicado boolean, anuncio jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id      uuid;
  v_estado  text;
  v_anuncio jsonb;
begin
  perform public.exigir_clave_agente(p_clave);
  if p_rol not in ('cliente', 'asesor') then
    raise exception 'ROL_INVALIDO: %', p_rol;
  end if;
  if coalesce(btrim(p_telefono), '') = '' or coalesce(btrim(p_phone_number_id), '') = '' then
    raise exception 'DATOS_INCOMPLETOS: falta el número';
  end if;

  select p.id, p.estado into v_id, v_estado
    from public.agente_pruebas p
   where p.canal = 'whatsapp' and p.phone_number_id = p_phone_number_id and p.telefono = p_telefono
   for update;

  if v_id is null then
    insert into public.agente_pruebas (canal, phone_number_id, telefono, contacto_nombre, titulo, anuncio)
    values ('whatsapp', p_phone_number_id, p_telefono, nullif(btrim(p_contacto), ''),
            left(coalesce(nullif(btrim(p_contacto), ''), p_telefono), 120),
            case when jsonb_typeof(p_anuncio) = 'object' then p_anuncio end)
    on conflict do nothing
    returning agente_pruebas.id, agente_pruebas.estado into v_id, v_estado;
    -- Otro webhook la abrió al mismo tiempo.
    if v_id is null then
      select p.id, p.estado into v_id, v_estado
        from public.agente_pruebas p
       where p.canal = 'whatsapp' and p.phone_number_id = p_phone_number_id and p.telefono = p_telefono
       for update;
    end if;
  end if;

  if p_wamid is not null and exists (select 1 from public.agente_pruebas_mensajes m where m.wamid = p_wamid) then
    return query select v_id, v_estado, true, (select p.anuncio from public.agente_pruebas p where p.id = v_id);
    return;
  end if;

  insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido, adjuntos, wamid, creado_en, autor_id)
  values (v_id, p_rol, coalesce(p_contenido, ''),
          case when jsonb_typeof(p_adjuntos) = 'array' and jsonb_array_length(p_adjuntos) > 0 then p_adjuntos end,
          p_wamid, coalesce(p_creado_en, now()), null);

  if p_rol = 'asesor' then
    v_estado := 'asesor';
  elsif v_estado = 'resuelta' then
    v_estado := 'agente';
  end if;

  update public.agente_pruebas p
     set estado          = v_estado,
         contacto_nombre = coalesce(nullif(btrim(p_contacto), ''), p.contacto_nombre),
         anuncio         = case when jsonb_typeof(p_anuncio) = 'object' then p_anuncio else p.anuncio end,
         motivo_atencion = case when v_estado in ('agente', 'asesor') then null else p.motivo_atencion end,
         atencion_desde  = case when v_estado in ('agente', 'asesor') then null else p.atencion_desde end,
         actualizado_en  = now()
   where p.id = v_id
  returning p.anuncio into v_anuncio;

  return query select v_id, v_estado, false, v_anuncio;
end $$;

/* ── Lo que el agente lee ────────────────────────────────────────────────────── */

-- La conversación para el modelo: los últimos 60 mensajes, en orden, y su anuncio.
create function public.wa_historial(p_clave text, p_conversacion uuid)
returns table (rol text, contenido text, adjuntos jsonb, creado_en timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.exigir_clave_agente(p_clave);
  return query
    select m.rol, m.contenido, m.adjuntos, m.creado_en
      from (select * from public.agente_pruebas_mensajes x
             where x.prueba_id = p_conversacion
             order by x.creado_en desc limit 60) m
     order by m.creado_en;
end $$;

-- Lo que necesita para responder, en una sola llamada: datos de la empresa,
-- ajustes del agente, configuración de la lista de precios, cuentas vigentes que
-- salen en el PDF y archivos que puede enviar.
create function public.wa_contexto(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.exigir_clave_agente(p_clave);
  return jsonb_build_object(
    'empresa',       (select valor from public.configuracion where clave = 'empresa'),
    'ajustes',       (select valor from public.configuracion where clave = 'agente_whatsapp'),
    'lista_precios', (select valor from public.configuracion where clave = 'lista_precios'),
    'cuentas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'banco', c.banco, 'tipo', c.tipo, 'moneda', c.moneda, 'numero', c.numero, 'cci', c.cci)
             order by c.vigente_desde)
        from public.cuentas_bancarias c
       where c.retirada_en is null and c.vigente_desde <= now() and c.en_pdf), '[]'::jsonb),
    'archivos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'nombre', d.nombre, 'tipo', d.tipo, 'mime', d.mime,
               'descripcion', d.descripcion, 'ruta', d.ruta)
             order by d.creado_en desc)
        from public.agente_documentos d
       where d.estado = 'listo' and d.enviable), '[]'::jsonb)
  );
end $$;

-- El catálogo de planchas (con sus formatos) y de accesorios, con la misma forma
-- que lee `cargarCatalogoPlanchas` / `cargarAccesorios`. Los precios salen de Odoo.
create function public.wa_catalogo(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.exigir_clave_agente(p_clave);
  return jsonb_build_object(
    'grupos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'material', g.material, 'variante', g.variante, 'detalle', g.detalle,
               'espesor_mm', g.espesor_mm, 'rotable', g.rotable, 'sobrantes_activo', g.sobrantes_activo,
               'formatos_plancha', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'codigo_odoo', f.codigo_odoo, 'ancho_cm', f.ancho_cm,
                          'largo_cm', f.largo_cm, 'por_verificar', f.por_verificar, 'nota', f.nota,
                          'activo', f.activo))
                   from public.formatos_plancha f where f.grupo_id = g.id), '[]'::jsonb))
             order by g.material, g.variante, g.detalle, g.espesor_mm)
        from public.grupos_plancha g), '[]'::jsonb),
    'accesorios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'codigo_odoo', a.codigo_odoo, 'categoria_id', a.categoria_id, 'activo', a.activo)
             order by a.codigo_odoo)
        from public.accesorios a), '[]'::jsonb),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'prefijo', c.prefijo, 'orden', c.orden)
             order by c.orden, c.nombre)
        from public.categorias_accesorio c), '[]'::jsonb)
  );
end $$;

-- La búsqueda en la base de conocimiento, para el webhook. Llama a la de siempre,
-- que corre con los permisos de esta función.
create function public.wa_buscar_fragmentos(
  p_clave     text,
  p_texto     text,
  p_embedding extensions.vector(1536) default null,
  p_modelo    text default null,
  p_limite    integer default 6
)
returns table (
  fragmento_id       uuid,
  documento_id       uuid,
  documento_nombre   text,
  documento_tipo     text,
  documento_enviable boolean,
  pagina             integer,
  contenido          text,
  puntaje            double precision
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.exigir_clave_agente(p_clave);
  return query select * from public.buscar_fragmentos_agente(p_texto, p_embedding, p_modelo, p_limite);
end $$;

/* ── Lo que el agente escribe ────────────────────────────────────────────────── */

-- Guarda la respuesta del agente, solo si la conversación sigue siendo suya (en
-- lo que el modelo pensaba, un asesor pudo haberla tomado). Devuelve si se puede
-- enviar. Si derivó, la conversación pasa a "necesita atención" con su motivo.
create function public.wa_guardar_respuesta(
  p_clave        text,
  p_conversacion uuid,
  p_contenido    text,
  p_adjuntos     jsonb,
  p_traza        jsonb,
  p_derivado     boolean,
  p_motivo       text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
begin
  perform public.exigir_clave_agente(p_clave);
  select estado into v_estado from public.agente_pruebas where id = p_conversacion and canal = 'whatsapp' for update;
  if v_estado is distinct from 'agente' then
    return false;
  end if;

  insert into public.agente_pruebas_mensajes (prueba_id, rol, contenido, adjuntos, traza, derivado, autor_id)
  values (p_conversacion, 'agente', coalesce(p_contenido, ''),
          case when jsonb_typeof(p_adjuntos) = 'array' and jsonb_array_length(p_adjuntos) > 0 then p_adjuntos end,
          case when jsonb_typeof(p_traza) = 'array' then p_traza end,
          coalesce(p_derivado, false), null);

  update public.agente_pruebas
     set actualizado_en = now(),
         estado          = case when p_derivado then 'necesita_atencion' else estado end,
         motivo_atencion = case when p_derivado then left(nullif(btrim(p_motivo), ''), 300) else motivo_atencion end,
         atencion_desde  = case when p_derivado then now() else atencion_desde end
   where id = p_conversacion;
  return true;
end $$;

-- Para cuando algo falla después de decidir responder (el modelo, o el envío por
-- WhatsApp): que lo vea una persona.
create function public.wa_pedir_atencion(p_clave text, p_conversacion uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.exigir_clave_agente(p_clave);
  update public.agente_pruebas
     set estado = 'necesita_atencion',
         motivo_atencion = left(nullif(btrim(p_motivo), ''), 300),
         atencion_desde = coalesce(atencion_desde, now()),
         actualizado_en = now()
   where id = p_conversacion and canal = 'whatsapp' and estado in ('agente', 'necesita_atencion');
end $$;

/* ── Permisos ────────────────────────────────────────────────────────────────── */

revoke execute on function public.wa_recibir_mensaje(text, text, text, text, text, text, text, jsonb, jsonb, timestamptz) from public;
revoke execute on function public.wa_historial(text, uuid) from public;
revoke execute on function public.wa_contexto(text) from public;
revoke execute on function public.wa_catalogo(text) from public;
revoke execute on function public.wa_buscar_fragmentos(text, text, extensions.vector, text, integer) from public;
revoke execute on function public.wa_guardar_respuesta(text, uuid, text, jsonb, jsonb, boolean, text) from public;
revoke execute on function public.wa_pedir_atencion(text, uuid, text) from public;

-- Las llama el servidor sin sesión (anon). Sin la clave no hacen nada.
grant execute on function public.wa_recibir_mensaje(text, text, text, text, text, text, text, jsonb, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.wa_historial(text, uuid) to anon, authenticated;
grant execute on function public.wa_contexto(text) to anon, authenticated;
grant execute on function public.wa_catalogo(text) to anon, authenticated;
grant execute on function public.wa_buscar_fragmentos(text, text, extensions.vector, text, integer) to anon, authenticated;
grant execute on function public.wa_guardar_respuesta(text, uuid, text, jsonb, jsonb, boolean, text) to anon, authenticated;
grant execute on function public.wa_pedir_atencion(text, uuid, text) to anon, authenticated;

-- Los archivos que el agente puede mandar (catálogos, fichas, fotos marcadas como
-- "enviables") se pueden firmar sin sesión: Meta los descarga del enlace temporal.
-- Son material para clientes y su ruta lleva un uuid; el resto del bucket sigue cerrado.
-- SECURITY DEFINER: anon no ve `agente_documentos` (su RLS es de Administración).
create function public.documento_agente_enviable(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.agente_documentos d where d.ruta = p_ruta and d.enviable and d.estado = 'listo')
$$;

create policy agente_conocimiento_enviables on storage.objects
  for select to anon
  using (bucket_id = 'agente_conocimiento' and public.documento_agente_enviable(name));
