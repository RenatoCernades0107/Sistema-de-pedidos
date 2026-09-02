/**
 * Vacía la cola de `notificaciones` firmando y mandando un Web Push por cada
 * dispositivo del destinatario.
 *
 * Vive aquí y no en Next a propósito. Firmar un push exige la clave privada VAPID
 * y leer las suscripciones de OTRA persona exige la clave de servicio: dos
 * secretos de servidor. Dentro de Supabase se quedan en los secretos de la
 * función; en Vercel habrían tenido que entrar al entorno de la app web, que hoy
 * no guarda ninguno (ver web/.env.example).
 *
 * La llaman dos caminos, los dos con un JWT válido, así que `verify_jwt` queda en
 * true y no hace falta inventar un secreto compartido:
 *   - la Server Action, con after(), justo después de guardar el pedido;
 *   - el cron del minuto (`despachar_push()`), con la clave de servicio.
 *
 * No mira quién llama: solo manda lo que ya está en la cola y devuelve un conteo,
 * nunca el contenido. No hay nada que filtrar.
 */

import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Notificacion = {
  id: number;
  destinatario_id: string;
  titulo: string;
  cuerpo: string;
  url: string;
};

type Suscripcion = {
  id: string;
  usuario_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/* Las claves VAPID son un par de JWK; se guardan como el JSON que escupe
   `generate-vapid-keys` (ver web/README.md). extractable: false — una vez dentro
   de SubtleCrypto no vuelven a salir. */
const vapidKeys = await webpush.importVapidKeys(
  JSON.parse(Deno.env.get("VAPID_JWK")!),
  { extractable: false },
);

/* Se arma una sola vez por instancia, no por petición: importar las claves y
   derivar el servidor de aplicación es lo más caro de todo esto. */
const servidor = await webpush.ApplicationServer.new({
  contactInformation: Deno.env.get("VAPID_SUBJECT")!,
  vapidKeys,
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async () => {
  /* Reserva el lote. La función hace `for update skip locked`, así que si el cron
     y un after() entran a la vez, el segundo se lleva otras filas en lugar de
     mandar las mismas otra vez. */
  const { data: pendientes, error } = await supabase
    .rpc("tomar_notificaciones", { p_limite: 50 })
    .returns<Notificacion[]>();

  if (error) {
    console.error("no se pudo tomar la cola:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!pendientes || pendientes.length === 0) {
    return Response.json({ tomadas: 0, entregadas: 0, muertas: 0 });
  }

  /* Una sola consulta para todos los destinatarios del lote, no una por aviso. */
  const destinatarios = [...new Set(pendientes.map((n) => n.destinatario_id))];
  const { data: suscripciones } = await supabase
    .from("suscripciones_push")
    .select("id, usuario_id, endpoint, p256dh, auth")
    .in("usuario_id", destinatarios)
    .returns<Suscripcion[]>();

  const porUsuario = new Map<string, Suscripcion[]>();
  for (const s of suscripciones ?? []) {
    const lista = porUsuario.get(s.usuario_id) ?? [];
    lista.push(s);
    porUsuario.set(s.usuario_id, lista);
  }

  const enviadas: number[] = [];
  const fallidas: { id: number; error: string }[] = [];
  const muertas: string[] = [];
  const usadas: string[] = [];
  let entregadas = 0;

  for (const aviso of pendientes) {
    const dispositivos = porUsuario.get(aviso.destinatario_id) ?? [];

    /* Sin dispositivos no hay nada que reintentar: la persona no activó los
       avisos. Se marca enviada igual, con el motivo escrito, para que no vuelva
       cinco veces a lo mismo. */
    if (dispositivos.length === 0) {
      fallidas.push({ id: aviso.id, error: "sin suscripciones" });
      continue;
    }

    const carga = JSON.stringify({
      titulo: aviso.titulo,
      cuerpo: aviso.cuerpo,
      url: aviso.url,
    });

    let algunaEntregada = false;
    let ultimoError = "";

    for (const d of dispositivos) {
      try {
        await servidor
          .subscribe({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } })
          .pushTextMessage(carga, { urgency: webpush.Urgency.High });

        algunaEntregada = true;
        entregadas++;
        usadas.push(d.id);
      } catch (e) {
        const estado = e instanceof webpush.PushMessageError ? e.response.status : 0;

        /* 404/410 = esa suscripción ya no existe (el navegador se desinstaló, se
           limpiaron los datos del sitio, iOS la revocó). Se borra: reintentarla
           es gastar llamadas para siempre. */
        if (estado === 404 || estado === 410) {
          muertas.push(d.id);
          ultimoError = `suscripción caducada (${estado})`;
          continue;
        }

        /* 429 y 5xx son temporales: se deja el aviso sin marcar para que el
           siguiente pase lo reintente. */
        ultimoError = e instanceof Error ? e.message || String(estado) : String(e);
        console.error(`push fallido (${estado}) para ${aviso.id}:`, ultimoError);
      }
    }

    if (algunaEntregada) {
      enviadas.push(aviso.id);
    } else if (muertas.length > 0 && dispositivos.every((d) => muertas.includes(d.id))) {
      /* Todos los dispositivos estaban muertos: no hay a dónde mandarlo. */
      fallidas.push({ id: aviso.id, error: ultimoError });
    }
    /* Si no, se deja pendiente y se reintenta en el siguiente pase. */
  }

  if (enviadas.length > 0) {
    await supabase
      .from("notificaciones")
      .update({ enviada_en: new Date().toISOString(), error: null })
      .in("id", enviadas);
  }

  for (const f of fallidas) {
    await supabase
      .from("notificaciones")
      .update({ enviada_en: new Date().toISOString(), error: f.error })
      .eq("id", f.id);
  }

  if (muertas.length > 0) {
    await supabase.from("suscripciones_push").delete().in("id", muertas);
  }

  if (usadas.length > 0) {
    await supabase
      .from("suscripciones_push")
      .update({ usada_en: new Date().toISOString() })
      .in("id", usadas);
  }

  return Response.json({
    tomadas: pendientes.length,
    entregadas,
    muertas: muertas.length,
  });
});
