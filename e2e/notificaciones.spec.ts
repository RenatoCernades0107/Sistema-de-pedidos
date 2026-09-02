/**
 * Los avisos, hasta donde una prueba automática puede llegar honestamente.
 *
 * Lo que SÍ se prueba: que crear un pedido con responsable enlazado encola UN
 * aviso para la cuenta de esa persona y para nadie más; que la RLS de
 * `notificaciones` y `suscripciones_push` aguanta (nadie lee ni borra lo ajeno);
 * que el upsert por endpoint reasigna el dueño en la PC compartida; y que el
 * botón sale en la cabecera.
 *
 * Lo que NO se prueba y no se finge:
 *
 *   - **La entrega del push.** Hace falta un servicio de push de verdad (FCM,
 *     Mozilla, Apple) y un teléfono al otro lado. Se verifica a mano; la lista
 *     está en web/README.md.
 *   - **`pushManager.subscribe()` desde el navegador.** Chromium habla con FCM
 *     de verdad, así que meterlo aquí trae red ajena y una clave real a una
 *     prueba que lo que quiere comprobar es la base. Las filas se escriben con la
 *     sesión de cada persona, que es exactamente lo que hace la Server Action.
 *
 * Como el resto de la carpeta: base real, filas propias con prefijo `E2E`, y todo
 * lo que se crea se borra en el afterAll —incluido el trabajador de prueba, que
 * es estado compartido y dejarlo puesto cambiaría a quién le llegan los avisos.
 */


import { expect, test } from "@playwright/test";
import { borrarPedido, entrar, sesionDe, USUARIOS } from "./apoyo";

const NOMBRE_TRABAJADOR = "E2E responsable avisos";
const ENDPOINT = `https://e2e-plexiacril.example/push/${Date.now()}`;

let trabajadorId: string;
let idOperaciones: string;
let codigo: string | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const supabase = await sesionDe("administracion");

  const { data: usuario, error: errorUsuario } = await supabase
    .from("usuarios")
    .select("id")
    .eq("usuario", USUARIOS.operaciones)
    .single();
  if (errorUsuario) throw new Error(`No se encontró la cuenta de taller: ${errorUsuario.message}`);
  idOperaciones = usuario.id;

  // Un trabajador propio, enlazado a la cuenta del taller. No se toca ninguno de
  // los cinco de verdad: cambiarles el enlace afectaría a los avisos reales.
  const { data: trabajador, error } = await supabase
    .from("trabajadores")
    .insert({ nombre: NOMBRE_TRABAJADOR, usuario_id: idOperaciones })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el trabajador de prueba: ${error.message}`);
  trabajadorId = trabajador.id;
});

test.afterAll(async () => {
  const supabase = await sesionDe("administracion");
  if (codigo) await borrarPedido(codigo);
  if (trabajadorId) await supabase.from("trabajadores").delete().eq("id", trabajadorId);
  await supabase.from("suscripciones_push").delete().like("endpoint", "%e2e-plexiacril%");
});

test("el pedido nuevo encola el aviso para el responsable, y solo para él", async () => {
  const supabase = await sesionDe("administracion");
  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const { data: nuevo, error } = await supabase.rpc("crear_pedido", {
    p_es_provincia: false,
    p_nombre_cliente: "E2E avisos",
    p_tipos_pedido: ["CL"],
    p_cantidad: 1,
    p_tipo_pago: "contado",
    p_lugar_entrega: "tienda",
    p_fecha_prometida: manana,
    p_monto_total: 120,
    p_responsable_id: trabajadorId,
  });
  if (error) throw new Error(error.message);
  codigo = nuevo!;

  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id")
    .eq("codigo", codigo)
    .single();

  const { data: avisos } = await supabase
    .from("notificaciones")
    .select("tipo, destinatario_id, cuerpo")
    .eq("pedido_id", pedido!.id);

  expect(avisos).toHaveLength(1);
  expect(avisos![0].tipo).toBe("pedido_creado");
  expect(avisos![0].destinatario_id).toBe(idOperaciones);
  expect(avisos![0].cuerpo).toContain(codigo);
});

test("quien no es el destinatario no lee el aviso", async () => {
  // La RLS de `notificaciones` deja ver las propias y, a Administración, todas.
  // Logística no es ni lo uno ni lo otro: para ella la fila no existe.
  const supabase = await sesionDe("logistica");
  const { data: pedido } = await supabase.from("pedidos").select("id").eq("codigo", codigo!).single();

  const { data: avisos } = await supabase
    .from("notificaciones")
    .select("id")
    .eq("pedido_id", pedido!.id);

  expect(avisos).toEqual([]);
});

test("la suscripción se guarda a nombre de quien la crea, y nadie más la ve", async () => {
  /* No se conduce el navegador para esto a propósito. `pushManager.subscribe()`
     necesita un servicio de push de verdad detrás —Chromium habla con FCM— y eso
     mete red ajena y una clave real en una prueba que lo que quiere comprobar es
     la RLS. La fila se escribe con la sesión de la persona, que es exactamente lo
     que hace la Server Action, y se comprueba quién puede leerla. */
  const taller = await sesionDe("operaciones");

  const { error } = await taller.from("suscripciones_push").insert({
    usuario_id: idOperaciones,
    endpoint: ENDPOINT,
    p256dh: "BEjPTQ2TrOtQiVCr3nH2ZlPP1V0oGmM5vGWO6JKMr0k",
    auth: "k9xY2mQpLr8sTvWn3ZaBcQ",
    navegador: "Playwright E2E",
  });
  expect(error).toBeNull();

  const { data: propias } = await taller
    .from("suscripciones_push")
    .select("usuario_id, endpoint")
    .eq("endpoint", ENDPOINT);
  expect(propias).toHaveLength(1);
  expect(propias![0].usuario_id).toBe(idOperaciones);

  // Otra cuenta no ve el endpoint. Quien lo tenga puede mandarle avisos a esa
  // persona, así que esto es lo que hay que sostener.
  const logistica = await sesionDe("logistica");
  const { data: ajenas } = await logistica
    .from("suscripciones_push")
    .select("id")
    .eq("endpoint", ENDPOINT);
  expect(ajenas).toEqual([]);

  // Ni la borra.
  await logistica.from("suscripciones_push").delete().eq("endpoint", ENDPOINT);
  const { data: sigue } = await taller
    .from("suscripciones_push")
    .select("id")
    .eq("endpoint", ENDPOINT);
  expect(sigue).toHaveLength(1);
});

test("una segunda persona en el mismo navegador se queda con el endpoint", async () => {
  /* El caso de la PC compartida del taller: el endpoint es del navegador, no de
     la persona. El upsert por `endpoint` tiene que reasignar el dueño, no dejar
     dos filas mandando los pedidos del primero al turno del segundo. */
  const logistica = await sesionDe("logistica");
  const { data: cuenta } = await logistica
    .from("usuarios")
    .select("id")
    .eq("usuario", USUARIOS.logistica)
    .single();

  const { error } = await logistica.from("suscripciones_push").upsert(
    {
      usuario_id: cuenta!.id,
      endpoint: ENDPOINT,
      p256dh: "BEjPTQ2TrOtQiVCr3nH2ZlPP1V0oGmM5vGWO6JKMr0k",
      auth: "k9xY2mQpLr8sTvWn3ZaBcQ",
      navegador: "Playwright E2E",
    },
    { onConflict: "endpoint" },
  );
  expect(error).toBeNull();

  const { data: filas } = await logistica
    .from("suscripciones_push")
    .select("usuario_id")
    .eq("endpoint", ENDPOINT);

  expect(filas).toHaveLength(1);
  expect(filas![0].usuario_id).toBe(cuenta!.id);
});

test("el botón de avisos está en la cabecera", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await entrar(page, "operaciones");

  // Sin NEXT_PUBLIC_VAPID_PUBLIC_KEY el botón no se pinta a propósito: la función
  // de envío no está desplegada y un botón que solo puede fallar sobra.
  const boton = page.getByRole("button", { name: /avisos/i });
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    test.skip(true, "sin clave VAPID configurada el botón no se muestra");
  }
  await expect(boton).toBeVisible();
});
