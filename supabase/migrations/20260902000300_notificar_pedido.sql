-- El motor de avisos: quién recibe, qué dice, y cuándo se encola.
--
-- Está partido en tres funciones pequeñas a propósito. Agregar un aviso nuevo
-- (cambio de estado, fecha prometida vencida) es: un valor al enum
-- `tipo_notificacion`, un par de `when` en `texto_notificacion`, y el trigger que
-- lo dispare. Nada más se toca: ni la cola, ni la Edge Function, ni el navegador.

-- ── 1. A quién ───────────────────────────────────────────────────────────────

-- Traduce el responsable del pedido (un trabajador) a su cuenta de la app.
--
-- Devuelve NULL en los tres casos en que no hay a quién avisar: el trabajador no
-- tiene cuenta enlazada, el trabajador está desactivado, o la cuenta está
-- desactivada. Los tres se tratan igual y ninguno es un error.
create function public.usuario_de_trabajador(p_trabajador_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
    from public.trabajadores t
    join public.usuarios u on u.id = t.usuario_id
   where t.id = p_trabajador_id
     and t.activo
     and u.activo
$$;

-- ── 2. Qué dice ──────────────────────────────────────────────────────────────

-- El único sitio con texto de cara a la persona. Se eligió una función y no una
-- tabla de plantillas porque con dos avisos la tabla es andamiaje: obliga a un
-- seed, no se revisa en el diff de la migración, y no gana nada mientras el texto
-- lo escriba quien escribe el SQL.
create function public.texto_notificacion(
  p_tipo   public.tipo_notificacion,
  p_codigo text
)
returns table (titulo text, cuerpo text)
language sql
immutable
as $$
  select
    case p_tipo
      when 'pedido_creado'        then 'Nuevo pedido a tu nombre'
      when 'responsable_asignado' then 'Te asignaron un pedido'
    end,
    case p_tipo
      when 'pedido_creado'
        then 'Se registró el pedido ' || p_codigo || ' y eres el responsable.'
      when 'responsable_asignado'
        then 'Ahora eres el responsable del pedido ' || p_codigo || '.'
    end
$$;

-- ── 3. Cuándo ────────────────────────────────────────────────────────────────

create function public.notificar_pedido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo         public.tipo_notificacion;
  v_destinatario uuid;
  v_titulo       text;
  v_cuerpo       text;
begin
  -- Un pedido sin responsable no avisa a nadie: todavía no es de nadie.
  if new.responsable_id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_tipo := 'pedido_creado';
  elsif old.responsable_id is distinct from new.responsable_id then
    -- Solo al nuevo. Al anterior no se le dice nada: dejar de ser responsable no
    -- es una tarea, y avisarlo llena el teléfono de ruido.
    v_tipo := 'responsable_asignado';
  else
    return null;
  end if;

  v_destinatario := public.usuario_de_trabajador(new.responsable_id);
  if v_destinatario is null then
    return null;
  end if;

  select t.titulo, t.cuerpo
    into v_titulo, v_cuerpo
    from public.texto_notificacion(v_tipo, new.codigo) t;

  insert into public.notificaciones
    (destinatario_id, tipo, titulo, cuerpo, url, pedido_id)
  values
    (v_destinatario, v_tipo, v_titulo, v_cuerpo, '/pedidos/' || new.codigo, new.id);

  return null;

exception when others then
  -- El trigger corre dentro de la transacción de `crear_pedido`. Sin este bloque,
  -- un fallo al armar el aviso tumbaría el alta del pedido entero. Se prefiere
  -- perder el aviso —queda el warning en los logs— antes que perder el trabajo de
  -- quien estaba llenando el formulario.
  raise warning 'notificar_pedido: no se pudo encolar el aviso del pedido %: %',
    new.codigo, sqlerrm;
  return null;
end $$;

-- Un solo trigger cubre los dos caminos de escritura de la app (el RPC
-- `crear_pedido` y `asignarResponsable` → UPDATE) y también cualquier UPDATE
-- hecho a mano en SQL. Nada se escapa por el costado.
create trigger pedidos_notificar
  after insert or update of responsable_id on public.pedidos
  for each row execute function public.notificar_pedido();

-- ── 4. Tomar de la cola ──────────────────────────────────────────────────────

-- La usa la Edge Function `enviar-push` para reservar un lote antes de mandarlo.
--
-- `for update skip locked` es lo que hace que dos invocaciones a la vez (la de
-- after() y la del cron del minuto) no manden el mismo aviso dos veces: la
-- segunda salta las filas que la primera ya tiene tomadas.
--
-- La ventana de 2 minutos es un reintento: si la función se muere a mitad, la
-- fila queda tomada pero sin enviar, y pasados 2 minutos vuelve a estar
-- disponible. `intentos < 5` evita que un aviso roto se reintente para siempre.
create function public.tomar_notificaciones(p_limite int default 50)
returns setof public.notificaciones
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.notificaciones
     set tomada_en = now(),
         intentos  = intentos + 1
   where id in (
     select id
       from public.notificaciones
      where enviada_en is null
        and (tomada_en is null or tomada_en < now() - interval '2 minutes')
        and intentos < 5
      order by creado_en
      limit p_limite
        for update skip locked
   )
  returning *;
$$;

-- Solo la Edge Function la llama, y lo hace con la clave de servicio. Nadie con
-- una sesión de navegador tiene por qué vaciar la cola.
revoke execute on function public.tomar_notificaciones(int) from public, anon, authenticated;
grant  execute on function public.tomar_notificaciones(int) to service_role;

revoke execute on function public.usuario_de_trabajador(uuid) from public, anon;
grant  execute on function public.usuario_de_trabajador(uuid) to authenticated, service_role;
