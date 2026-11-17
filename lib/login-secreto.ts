/**
 * La clave que el servidor de Next le presenta a la base para que le traduzca un
 * usuario a su correo (`email_de_usuario`, `tiene_correo_recuperacion`). Sin ella
 * esas funciones no devuelven nada, así que cualquiera con la clave anon pública
 * no puede sacar el correo de un trabajador.
 *
 * Es un secreto de servidor: nada de `NEXT_PUBLIC_` ni de leerlo desde un archivo
 * `"use client"`. Si falta, el login falla cerrado y lo dice en el log.
 */
export function claveDeLogin(): string | null {
  const clave = process.env.LOGIN_SECRET;
  if (!clave) {
    console.error("[login] Falta LOGIN_SECRET: no se puede traducir el usuario a su correo.");
    return null;
  }
  return clave;
}

export const ERROR_LOGIN_SIN_CLAVE =
  "El inicio de sesión no está configurado. Avisa a Administración.";
