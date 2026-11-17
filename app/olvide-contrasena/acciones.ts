"use server";

import { clienteServidor } from "@/lib/supabase-servidor";
import { urlBase } from "@/lib/url-base";

export interface EstadoRecuperacion {
  error?: string;
  /** El usuario que se pidió, para devolverlo al campo. */
  usuario?: string;
  enviado?: boolean;
}

/**
 * Pide el enlace para elegir una contraseña nueva. Va al correo de recuperación de
 * la cuenta; si no tiene uno, no se manda nada.
 *
 * La respuesta es la misma exista o no el usuario, y tenga o no correo: decir
 * "ese usuario no existe" o "no tiene correo" le regala a cualquiera la lista de
 * cuentas, igual que en el login. A cambio, quien no tiene correo no se entera
 * aquí: el aviso le dice que, si no le llega nada, hable con Administración.
 */
export async function solicitarRecuperacion(
  _previo: EstadoRecuperacion,
  datos: FormData,
): Promise<EstadoRecuperacion> {
  const usuario = String(datos.get("usuario") ?? "").trim();

  if (!usuario) return { error: "Escribe tu usuario.", usuario };

  const supabase = await clienteServidor();

  const { data: tiene } = await supabase.rpc("tiene_correo_recuperacion", {
    nombre_usuario: usuario,
  });

  if (tiene) {
    const { data: email } = await supabase.rpc("email_de_usuario", {
      nombre_usuario: usuario,
    });

    if (email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${await urlBase()}/auth/confirmar`,
      });

      // El límite de envíos de Auth sí hay que decirlo: es la única razón por la
      // que la persona no recibirá nada y puede arreglarlo esperando un rato.
      if (error?.code === "over_email_send_rate_limit") {
        return { error: "Se pidieron demasiados correos. Espera unos minutos e inténtalo otra vez.", usuario };
      }
      if (error) console.error("[recuperacion]", error.code ?? error.message);
    }
  }

  return { enviado: true, usuario };
}
