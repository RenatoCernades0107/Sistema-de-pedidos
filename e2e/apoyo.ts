/**
 * Herramientas comunes de los tests de punta a punta.
 *
 * Dos avisos que valen para toda la carpeta:
 *
 *   1. **Se corre contra la base real**, que es la única que hay. Por eso cada
 *      prueba crea sus propias filas con el prefijo `E2E` en el nombre del cliente
 *      y las borra al terminar. Ninguna toca los 23 pedidos del seed.
 *   2. **Las contraseñas salen del entorno.** `E2E_PASSWORD` (por defecto la del
 *      seed) para los tres usuarios de prueba. Si alguien cambia la del seed, se
 *      cambia aquí por variable, no en el repositorio.
 */

import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import type { Database } from "@/lib/supabase-tipos";

export const USUARIOS = {
  administracion: "ana",
  logistica: "carla",
  operaciones: "miguel",
} as const;

export const CONTRASENA = process.env.E2E_PASSWORD ?? "plexi2026";

/** Cliente de Supabase con la sesión de un usuario, para preparar y limpiar datos. */
export async function sesionDe(usuario: keyof typeof USUARIOS) {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: `${USUARIOS[usuario]}@plexiacril.test`,
    password: CONTRASENA,
  });
  if (error) throw new Error(`No se pudo entrar como ${usuario}: ${error.message}`);

  return supabase;
}

/**
 * Registra un pedido a provincia con la misma función que usa la app y lo deja en
 * el taller, que es donde Operaciones puede verlo.
 *
 * Se crea por RPC y no rellenando el formulario a propósito: el formulario no
 * asocia sus etiquetas a los campos, así que un test que lo recorriera dependería
 * de la estructura del DOM y se rompería con cualquier retoque visual. Lo que
 * estas pruebas verifican es lo que la Fase 4 añadió —que la escritura llega a la
 * base, que sobrevive a una recarga y que cada rol solo puede lo suyo—, y eso pasa
 * por la misma función `crear_pedido` en los dos caminos.
 */
export async function crearPedidoDePrueba(etiqueta: string) {
  const supabase = await sesionDe("administracion");

  const { data: departamento } = await supabase
    .from("departamentos")
    .select("id")
    .eq("nombre", "La Libertad")
    .single();
  const { data: provincia } = await supabase
    .from("provincias")
    .select("id")
    .eq("departamento_id", departamento!.id)
    .eq("nombre", "Trujillo")
    .single();

  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const { data: codigo, error } = await supabase.rpc("crear_pedido", {
    p_es_provincia: true,
    p_nombre_cliente: `E2E ${etiqueta}`,
    p_tipos_pedido: ["CL"],
    p_cantidad: 1,
    p_tipo_pago: "a_cuenta",
    p_lugar_entrega: "agencia",
    p_fecha_prometida: manana,
    p_monto_total: 300,
    p_departamento_id: departamento!.id,
    p_provincia_id: provincia!.id,
    p_detalle: "1 Acrílico Alfa 3mm transparente F7",
  });
  if (error) throw new Error(`No se pudo crear el pedido de prueba: ${error.message}`);

  // El taller solo ve lo que está o se entrega en el taller.
  const { error: errorUbicacion } = await supabase
    .from("pedidos")
    .update({ ubicacion_actual: "taller" })
    .eq("codigo", codigo!);
  if (errorUbicacion) throw new Error(errorUbicacion.message);

  return codigo!;
}

/**
 * Un pedido local, en el taller y ya listo, pero sin facturar. Es el caso que
 * bloquea la entrega: el CHECK exige `numero_factura` para pasar a `entregado`, y
 * ni Operaciones ni Logística pueden escribirla.
 */
export async function crearPedidoLocalListo(etiqueta: string) {
  const supabase = await sesionDe("administracion");
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const { data: codigo, error } = await supabase.rpc("crear_pedido", {
    p_es_provincia: false,
    p_nombre_cliente: `E2E ${etiqueta}`,
    p_tipos_pedido: ["CM"],
    p_cantidad: 1,
    p_tipo_pago: "contado",
    p_lugar_entrega: "tienda",
    p_fecha_prometida: manana,
    p_monto_total: 90,
    p_ubicacion_actual: "taller",
  });
  if (error) throw new Error(`No se pudo crear el pedido local: ${error.message}`);

  // La máquina de estados no admite saltos: hay que pasar por en_proceso.
  for (const estado of ["en_proceso", "listo"] as const) {
    const { error: fallo } = await supabase
      .from("pedidos")
      .update({ estado })
      .eq("codigo", codigo!);
    if (fallo) throw new Error(`No se pudo dejar el pedido en ${estado}: ${fallo.message}`);
  }

  return codigo!;
}

/** Borra el pedido y, en cascada, su envío, pagos, historial y auditoría. */
export async function borrarPedido(codigo: string) {
  const supabase = await sesionDe("administracion");
  const { error } = await supabase.from("pedidos").delete().eq("codigo", codigo);
  if (error) throw new Error(`No se pudo borrar ${codigo}: ${error.message}`);
}

/**
 * Ejecuta algo que dispara una escritura y espera a que el servidor conteste.
 *
 * Hace falta de verdad: `click()` vuelve en cuanto suelta el evento, no cuando la
 * Server Action termina. Recargar justo después aborta el POST a media respuesta y
 * la prueba acaba mirando una página que no refleja lo que se acaba de guardar.
 * Una Server Action es un POST contra la propia ruta, así que se espera por eso.
 */
export async function alGuardar(page: Page, accion: () => Promise<void>) {
  const respuesta = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().isNavigationRequest() === false,
  );
  await accion();
  await respuesta;
}

/** Entra por la pantalla de login, como una persona. */
export async function entrar(page: Page, usuario: keyof typeof USUARIOS) {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(USUARIOS[usuario]);
  await page.getByLabel("Contraseña").fill(CONTRASENA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
