/**
 * Service worker de los avisos.
 *
 * Va en public/ y no en app/ porque tiene que servirse desde la raíz (/sw.js):
 * el alcance de un service worker es la carpeta desde donde se sirve, y desde
 * /_next/ no cubriría la app.
 */

self.addEventListener("push", (evento) => {
  /* iOS cancela la suscripción si llega un push y el service worker no muestra
     nada. Por eso hay valores por defecto y el JSON se lee dentro de un try: si
     el cuerpo viene roto igual se notifica, con texto genérico, antes que
     quedarse callado y perder la suscripción. */
  let datos = {
    titulo: "Plexiacril",
    cuerpo: "Tienes un aviso nuevo.",
    url: "/",
  };

  try {
    datos = { ...datos, ...evento.data.json() };
  } catch {
    // Cuerpo ausente o no-JSON: se usa el texto por defecto.
  }

  evento.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: "/icono-192.png",
      badge: "/icono-192.png",
      lang: "es-PE",
      data: { url: datos.url },
      /* Dos avisos del mismo pedido se reemplazan en vez de apilarse. Cubre el
         reintento de la cola: si el envío se duplicó, en pantalla sale uno. */
      tag: datos.url,
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = evento.notification.data?.url ?? "/";

  /* Si la app ya está abierta se enfoca esa pestaña en vez de abrir otra: en el
     celular instalado, abrir una ventana nueva cada vez deja la PWA con varias
     instancias del mismo pedido. */
  evento.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((ventanas) => {
        for (const ventana of ventanas) {
          if (new URL(ventana.url).pathname === url && "focus" in ventana) {
            return ventana.focus();
          }
        }
        const abierta = ventanas.find((v) => "navigate" in v);
        if (abierta) return abierta.navigate(url).then((v) => v && v.focus());
        return self.clients.openWindow(url);
      }),
  );
});
