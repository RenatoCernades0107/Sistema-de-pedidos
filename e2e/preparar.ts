/**
 * Deja el seed en condiciones de correr los tests y lo devuelve como estaba.
 *
 * La migración que obliga a cambiar la contraseña en el primer ingreso marcó
 * también a las cuentas que ya existían, ana, carla y miguel incluidas: sin bajar
 * esa marca, las tres se quedan en el formulario de cambio y no pasa una sola
 * prueba.
 *
 * Pero bajarla y ya sería tramposo: la marca de esas tres cuentas es real —están
 * usando `plexi2026`— y una corrida de tests no puede ser lo que la quite. Por eso
 * se anota cómo estaba cada una y se restaura al final. Playwright ejecuta como
 * teardown la función que devuelva el `globalSetup`.
 *
 * Con el correo de recuperación pasa lo mismo: sin uno registrado la app no deja
 * pasar de la bienvenida, así que se les pone uno de mentira y se les quita al final.
 *
 * Ninguna prueba cambia una contraseña de verdad: eso dejaría el seed distinto de
 * como estaba y la corrida siguiente no podría entrar. La pantalla de cambio se
 * prueba poniendo y quitando la marca, en `cambio-password-inicial.spec.ts`.
 */

import { USUARIOS, sesionDe } from "./apoyo";

export default async function preparar() {
  const supabase = await sesionDe("administracion");
  const cuentas = Object.values(USUARIOS);

  const { data: antes, error: fallo } = await supabase
    .from("usuarios")
    .select("usuario, debe_cambiar_password, email_recuperacion")
    .in("usuario", cuentas);

  if (fallo) throw new Error(`No se pudo leer el seed: ${fallo.message}`);

  // Sin correo de recuperación la app también las manda a la pantalla de bienvenida:
  // se les pone uno ficticio solo mientras dura la corrida. Se escribe en el perfil y
  // no en Auth: el correo con el que entran no cambia y no sale ningún correo.
  for (const usuario of cuentas) {
    const { error } = await supabase
      .from("usuarios")
      .update({
        debe_cambiar_password: false,
        email_recuperacion: `e2e.${usuario}@example.com`,
      })
      .eq("usuario", usuario);

    if (error) throw new Error(`No se pudo preparar el seed: ${error.message}`);
  }

  return async () => {
    const supabase = await sesionDe("administracion");
    for (const fila of antes ?? []) {
      await supabase
        .from("usuarios")
        .update({
          debe_cambiar_password: fila.debe_cambiar_password,
          email_recuperacion: fila.email_recuperacion,
        })
        .eq("usuario", fila.usuario);
    }
  };
}
