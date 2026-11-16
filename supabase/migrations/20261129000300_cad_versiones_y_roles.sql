-- Diseños (CAD): control de versiones a la vista y abiertos a los tres roles.
--
-- Cada guardado ya era una versión inmutable (`cad_diseno_versiones`). Lo que
-- faltaba para que "si otro edita tu diseño, vuelves a lo tuyo" sea fácil:
--
--   · quién guardó cada versión, por nombre (`autor_nombre`): `usuarios` solo
--     deja leer el perfil propio a quien no es Administración, así que se copia
--     al guardar, como `autor_nombre` de los mensajes del chat;
--   · restaurar una versión (`restaurar_version_diseno`): copia la vieja como
--     versión NUEVA. Nada se borra ni se reescribe: restaurar también se puede
--     deshacer restaurando otra;
--   · ponerle nombre a una versión ("Aprobada por el cliente");
--   · el aviso `diseno_modificado` cuando otra persona guarda sobre lo tuyo.
--
-- Y los diseños dejan de ser solo de Administración: los tres roles los ven y
-- los editan (el permiso `usarCad` de la app dice lo mismo). Lo que sigue
-- siendo de Administración:
--   · los precios y las cotizaciones (sus propias tablas, que no se tocan aquí);
--   · aprobar un diseño libre para producción (`aprobar_version_diseno`): es la
--     revisión del código que escribió el asistente antes de mandarlo a cortar.
--     Con más gente editando, esa puerta importa más, no menos;
--   · borrar el diseño de otra persona: borrar se lleva todo el historial y no
--     se puede deshacer, así que solo quien lo creó (o Administración).

-- ── 1. Permisos: los tres roles ─────────────────────────────────────────────
-- `auth_rol()` es NULL sin sesión o con la cuenta desactivada: eso sigue
-- cerrando la puerta. Los grants no cambian: versiones y mensajes, solo
-- select/insert (más la foto de la versión, que llega después).

drop policy cad_disenos_admin on public.cad_disenos;
drop policy cad_diseno_versiones_admin on public.cad_diseno_versiones;
drop policy cad_mensajes_admin on public.cad_mensajes;

create policy cad_disenos_lectura on public.cad_disenos
  for select to authenticated using (public.auth_rol() is not null);
create policy cad_disenos_crear on public.cad_disenos
  for insert to authenticated with check (public.auth_rol() is not null);
create policy cad_disenos_editar on public.cad_disenos
  for update to authenticated
  using (public.auth_rol() is not null) with check (public.auth_rol() is not null);
create policy cad_disenos_borrar on public.cad_disenos
  for delete to authenticated
  using (public.es_admin() or (public.auth_rol() is not null and creado_por = auth.uid()));

create policy cad_diseno_versiones_roles on public.cad_diseno_versiones
  for all to authenticated
  using (public.auth_rol() is not null) with check (public.auth_rol() is not null);
create policy cad_mensajes_roles on public.cad_mensajes
  for all to authenticated
  using (public.auth_rol() is not null) with check (public.auth_rol() is not null);

-- Las fotos de los diseños las sube quien los abre, sea del rol que sea. Las de
-- los productos del catálogo (`productos/…`) siguen siendo de Administración,
-- que es quien edita el catálogo.
drop policy miniaturas_storage_escritura on storage.objects;
create policy miniaturas_storage_escritura on storage.objects
  for all to authenticated
  using (bucket_id = 'miniaturas'
         and (public.es_admin() or (public.auth_rol() is not null and name like 'disenos/%')))
  with check (bucket_id = 'miniaturas'
              and (public.es_admin() or (public.auth_rol() is not null and name like 'disenos/%')));

-- ── 2. Columnas nuevas de la versión ────────────────────────────────────────

alter table public.cad_diseno_versiones
  add column nombre_version text
    check (nombre_version is null or (btrim(nombre_version) <> '' and length(nombre_version) <= 80)),
  add column restaurada_de integer,
  add column autor_nombre text not null default '';

alter table public.cad_diseno_versiones
  drop constraint cad_diseno_versiones_origen_check,
  add constraint cad_diseno_versiones_origen_check
    check (origen in ('formulario', 'chat', 'restauracion')),
  -- Una restauración dice de cuál viene, y solo ella; siempre de una anterior.
  add constraint cad_diseno_versiones_restaurada_check check (
    (origen = 'restauracion') = (restaurada_de is not null)
    and (restaurada_de is null or (restaurada_de >= 1 and restaurada_de < version))
  );

comment on column public.cad_diseno_versiones.nombre_version is
  'Nombre que alguien le puso a la versión ("Aprobada por el cliente"). Se cambia con nombrar_version_diseno.';
comment on column public.cad_diseno_versiones.restaurada_de is
  'Si la versión es una restauración, el número de la versión que se copió.';
comment on column public.cad_diseno_versiones.autor_nombre is
  'El nombre de quien la guardó, copiado al guardar (usuarios solo deja leer el perfil propio).';

update public.cad_diseno_versiones v
   set autor_nombre = u.nombre
  from public.usuarios u
 where u.id = v.creado_por;

-- Quién guarda lo dice la sesión, no lo que mande el navegador: de esto
-- dependen el "Tú" del historial y a quién se avisa. Sin sesión (migraciones,
-- seed) se respeta lo que venga.
create function public.firmar_version_diseno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.creado_por := auth.uid();
  end if;
  select u.nombre into new.autor_nombre from public.usuarios u where u.id = new.creado_por;
  new.autor_nombre := coalesce(new.autor_nombre, '');
  return new;
end $$;

revoke execute on function public.firmar_version_diseno() from public, anon, authenticated;

create trigger cad_diseno_versiones_firmar
  before insert on public.cad_diseno_versiones
  for each row execute function public.firmar_version_diseno();

-- ── 3. Restaurar una versión ────────────────────────────────────────────────
-- Copia la versión pedida como la siguiente, con `origen = 'restauracion'`.
-- SECURITY INVOKER como `guardar_version_diseno`: la RLS decide y `auth.uid()`
-- firma. El número sale del mismo UPDATE que bloquea la fila del diseño, así
-- que no compite con el formulario ni con el asistente.
--
-- Estado:
--   · plantilla → 'aprobado' sin firma, como nace toda versión de plantilla;
--   · libre     → 'aprobado' solo si ESE MISMO código ya se aprobó en este
--                 diseño (la versión que se copia u otra con el mismo código):
--                 la geometría revisada es la misma, como en
--                 `guardar_version_diseno_libre`. Conserva quién y cuándo. Si
--                 no, 'borrador'.
--
-- La miniatura se copia: es la misma geometría y la foto ya existe.

create function public.restaurar_version_diseno(p_diseno_id uuid, p_version integer)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actual   integer;
  v_version  integer;
  v_origen   public.cad_diseno_versiones%rowtype;
  v_aprobada boolean := false;
  v_apr_por  uuid;
  v_apr_en   timestamptz;
begin
  select version_actual into v_actual from public.cad_disenos where id = p_diseno_id;
  if v_actual is null then
    raise exception 'El diseño ya no existe o tu rol no puede cambiarlo.';
  end if;
  if p_version = v_actual then
    raise exception 'La v% ya es la versión actual: no hay nada que restaurar.', p_version;
  end if;

  select * into v_origen from public.cad_diseno_versiones
   where diseno_id = p_diseno_id and version = p_version;
  if v_origen.id is null then
    raise exception 'La v% de este diseño no existe.', p_version;
  end if;

  update public.cad_disenos
     set version_actual = version_actual + 1
   where id = p_diseno_id
  returning version_actual into v_version;

  if v_version is null then
    raise exception 'El diseño ya no existe o tu rol no puede cambiarlo.';
  end if;

  if v_origen.plantilla = 'libre' then
    select aprobado_por, aprobado_en into v_apr_por, v_apr_en
      from public.cad_diseno_versiones
     where diseno_id = p_diseno_id and plantilla = 'libre' and estado = 'aprobado'
       and codigo = v_origen.codigo
     order by (version = p_version) desc, version desc
     limit 1;
    v_aprobada := found;
  end if;

  insert into public.cad_diseno_versiones
    (diseno_id, version, plantilla, version_plantilla, parametros, origen, restaurada_de,
     grupo_plancha_id, color, acomodo, materiales, codigo, miniatura_path,
     estado, aprobado_por, aprobado_en)
  values
    (p_diseno_id, v_version, v_origen.plantilla, v_origen.version_plantilla, v_origen.parametros,
     'restauracion', p_version,
     v_origen.grupo_plancha_id, v_origen.color, v_origen.acomodo, v_origen.materiales,
     v_origen.codigo, v_origen.miniatura_path,
     case
       when v_origen.plantilla <> 'libre' then 'aprobado'
       when v_aprobada then 'aprobado'
       else 'borrador'
     end,
     case when v_aprobada then v_apr_por end,
     case when v_aprobada then v_apr_en end);

  return v_version;
end $$;

revoke execute on function public.restaurar_version_diseno(uuid, integer) from public, anon;
grant execute on function public.restaurar_version_diseno(uuid, integer) to authenticated;

-- ── 4. Ponerle nombre a una versión ─────────────────────────────────────────
-- Las versiones no se actualizan desde la app (solo su foto), así que el nombre
-- pasa por aquí: SECURITY DEFINER para el UPDATE, con la comprobación de rol
-- explícita y tocando solo esta columna. Vacío o null quita el nombre.

create function public.nombrar_version_diseno(p_diseno_id uuid, p_version integer, p_nombre text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
begin
  if public.auth_rol() is null then
    raise exception 'Tu sesión no puede cambiar diseños.';
  end if;
  if length(v_nombre) > 80 then
    raise exception 'El nombre de la versión es demasiado largo (máximo 80 caracteres).';
  end if;

  update public.cad_diseno_versiones
     set nombre_version = v_nombre
   where diseno_id = p_diseno_id and version = p_version;

  if not found then
    raise exception 'Esa versión del diseño no existe.';
  end if;
end $$;

revoke execute on function public.nombrar_version_diseno(uuid, integer, text) from public, anon;
grant execute on function public.nombrar_version_diseno(uuid, integer, text) to authenticated;

-- ── 5. Aviso: "cambiaron tu diseño" ─────────────────────────────────────────
-- Al guardarse una versión, se avisa a quien guardó la anterior (o, en la
-- primera, a quien creó el diseño) y a quien creó el diseño, si no son quien
-- acaba de guardar y su cuenta sigue activa.
--
-- Para no inundar: a una persona se le avisa de un diseño como mucho una vez
-- cada 30 minutos, SALVO que entretanto ella misma haya vuelto a guardar en
-- ese diseño. Así quien edita a la par recibe un aviso por "ronda", no uno por
-- cada pausa al escribir del otro.

create function public.notificar_diseno_modificado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_diseno   public.cad_disenos%rowtype;
  v_anterior uuid;
  v_dest     uuid;
  v_url      text;
  v_ultimo   timestamptz;
  v_titulo   text;
  v_cuerpo   text;
begin
  if auth.uid() is null or new.creado_por is null then
    return null;
  end if;

  select * into v_diseno from public.cad_disenos where id = new.diseno_id;
  select creado_por into v_anterior from public.cad_diseno_versiones
   where diseno_id = new.diseno_id and version = new.version - 1;

  v_url := '/disenos/' || new.diseno_id || '?historial=1';
  v_cuerpo := case
    when new.origen = 'restauracion'
      then v_diseno.nombre || ': volvió a la v' || new.restaurada_de || ' (ahora v' || new.version || ').'
    else v_diseno.nombre || ': ahora va en la v' || new.version || '.'
  end;

  for v_dest in
    select distinct d from unnest(array[coalesce(v_anterior, v_diseno.creado_por), v_diseno.creado_por]) d
     where d is not null and d <> new.creado_por
  loop
    if not exists (select 1 from public.usuarios u where u.id = v_dest and u.activo) then
      continue;
    end if;

    select max(n.creado_en) into v_ultimo
      from public.notificaciones n
     where n.destinatario_id = v_dest and n.tipo = 'diseno_modificado' and n.url = v_url
       and n.creado_en > now() - interval '30 minutes';
    if v_ultimo is not null and not exists (
      select 1 from public.cad_diseno_versiones v
       where v.diseno_id = new.diseno_id and v.creado_por = v_dest and v.creado_en > v_ultimo
    ) then
      continue;
    end if;

    v_titulo := coalesce(nullif(new.autor_nombre, ''), 'Alguien')
      || case when v_dest = v_diseno.creado_por then ' modificó tu diseño'
              else ' modificó un diseño que editaste' end;

    insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, url)
    values (v_dest, 'diseno_modificado', v_titulo, v_cuerpo, v_url);
  end loop;

  return null;

exception when others then
  -- Como en `notificar_pedido`: perder un aviso antes que perder la versión.
  raise warning 'notificar_diseno_modificado: no se pudo encolar el aviso de la versión %: %', new.id, sqlerrm;
  return null;
end $$;

revoke execute on function public.notificar_diseno_modificado() from public, anon, authenticated;

create trigger cad_diseno_versiones_notificar
  after insert on public.cad_diseno_versiones
  for each row execute function public.notificar_diseno_modificado();

create index cad_diseno_versiones_autor_idx
  on public.cad_diseno_versiones (diseno_id, creado_por, creado_en);
