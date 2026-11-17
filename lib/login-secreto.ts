/**
 * La clave que el servidor de Next le presenta a la base para que le traduzca un
 * usuario a su correo (`email_de_usuario`, `tiene_correo_recuperacion`). Sin ella
 * esas funciones no devuelven nada, así que cualquiera con la clave anon pública
 * no puede sacar el correo de un trabajador.
 *
 * Es un secreto de servidor: nada de `NEXT_PUBLIC_` ni de leerlo desde un archivo
 * `"use client"`. Si falta en producción, el login falla cerrado y lo dice en el log.
 */

/**
 * El valor que `supabase/seed.sql` inserta en `secretos_app`. Solo sirve contra una base
 * sembrada en local: en un proyecto alojado la fila `login` lleva otro valor, así que
 * usarlo como respaldo no abre nada. Fuera de producción evita tener que definir
 * `LOGIN_SECRET` en cada máquina de desarrollo.
 */
export const CLAVE_DE_DESARROLLO = "plexi-login-dev-secreto";

let avisado = false;

export function claveDeLogin(): string | null {
  const clave = process.env.LOGIN_SECRET;
  if (clave) return clave;

  if (process.env.NODE_ENV !== "production") {
    if (!avisado) {
      avisado = true;
      console.warn(
        "[login] LOGIN_SECRET no está definida: se usa la clave de desarrollo de seed.sql. " +
          "Si el login falla, ponla en .env.local con el valor de secretos_app ('login').",
      );
    }
    return CLAVE_DE_DESARROLLO;
  }

  console.error("[login] Falta LOGIN_SECRET: no se puede traducir el usuario a su correo.");
  return null;
}

export const ERROR_LOGIN_SIN_CLAVE =
  "El inicio de sesión no está configurado. Avisa a Administración.";
