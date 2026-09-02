-- Red de seguridad del envío: un cron que vacía la cola cada minuto.
--
-- El camino normal es que la Server Action llame a la Edge Function con after()
-- justo después de guardar el pedido, y el aviso salga en un segundo. Pero ese
-- camino depende de que Next siga vivo: un deploy a mitad de request, la función
-- caída un momento, o un UPDATE hecho a mano en SQL, y el aviso se queda en la
-- cola sin que nadie lo mire.
--
-- Con esto, lo peor que pasa es que el aviso llegue un minuto tarde.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ── Los secretos van en Vault, no en esta migración ──────────────────────────
--
-- La URL de la función y la clave de servicio no pueden vivir en un archivo que se
-- commitea. Se guardan en Vault una sola vez, a mano, y esta migración solo los
-- lee por nombre. Las instrucciones están en web/README.md; hasta que se corran,
-- `despachar_push()` no hace nada y lo deja dicho en un warning.

create function public.despachar_push()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url   text;
  v_clave text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'url_enviar_push';

  select decrypted_secret into v_clave
    from vault.decrypted_secrets where name = 'clave_servicio';

  if v_url is null or v_clave is null then
    raise warning 'despachar_push: faltan los secretos url_enviar_push / clave_servicio en Vault';
    return;
  end if;

  -- Si no hay nada pendiente no se gasta una llamada HTTP. La consulta usa el
  -- índice parcial `notificaciones_pendientes_idx`, así que cuesta nada.
  if not exists (select 1 from public.notificaciones where enviada_en is null) then
    return;
  end if;

  -- pg_net es asíncrono: esto encola el POST y vuelve. No se espera la respuesta,
  -- y no hace falta: quien lleva la cuenta de lo enviado es la propia tabla.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_clave
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

revoke execute on function public.despachar_push() from public, anon, authenticated;

-- ── Purga ────────────────────────────────────────────────────────────────────
--
-- Las enviadas se guardan 90 días para poder responder "¿se le avisó del pedido?".
-- Más allá de eso no le sirven a nadie y la tabla crece sin techo.
create function public.purgar_notificaciones()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.notificaciones
   where enviada_en is not null
     and enviada_en < now() - interval '90 days';
$$;

revoke execute on function public.purgar_notificaciones() from public, anon, authenticated;

-- ── Los dos jobs ─────────────────────────────────────────────────────────────
-- Se desprograman primero para que la migración se pueda volver a correr sin
-- terminar con el mismo job dos veces.

do $$
begin
  perform cron.unschedule('despachar-push');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('purgar-notificaciones');
exception when others then null;
end $$;

select cron.schedule('despachar-push', '* * * * *', 'select public.despachar_push()');
select cron.schedule('purgar-notificaciones', '17 4 * * *', 'select public.purgar_notificaciones()');
