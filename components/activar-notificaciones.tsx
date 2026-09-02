"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { borrarSuscripcion, guardarSuscripcion } from "@/app/(app)/notificaciones-acciones";

/**
 * El botón que activa los avisos del navegador.
 *
 * Tres cosas que parecen detalles y no lo son:
 *
 *   1. **`requestPermission()` va dentro del handler del click.** En iOS,
 *      llamarlo desde un `useEffect` o un `setTimeout` se bloquea en silencio: no
 *      lanza, no devuelve `denied`, simplemente no pasa nada y la persona cree
 *      que la app está rota.
 *   2. **En iPhone solo existe dentro de la PWA instalada** (iOS 16.4+). En
 *      Safari a secas `window.PushManager` ni está, así que el botón no se
 *      esconde: se queda para poder explicar que hay que añadirla a la pantalla
 *      de inicio. Esconderlo dejaría a media empresa sin enterarse nunca.
 *   3. **La suscripción se revalida en cada carga.** El endpoint puede rotar solo
 *      (el navegador lo renueva, o Safari tira el service worker tras semanas sin
 *      abrir la app) y entonces la fila de la base apunta a un destino muerto sin
 *      que nadie se entere. Volver a guardarla al montar es barato y lo arregla.
 */

const CLAVE_PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type Estado = "cargando" | "sin-soporte" | "instalar" | "desactivado" | "activado" | "bloqueado";

/**
 * La clave VAPID viaja en base64url y `subscribe()` la quiere en bytes.
 *
 * El buffer se crea a mano en vez de con `Uint8Array.from`: el tipo de esa
 * devuelve `Uint8Array<ArrayBufferLike>`, y `applicationServerKey` exige un
 * `BufferSource` respaldado por un `ArrayBuffer` de verdad, no por uno compartido.
 */
function clavePublicaEnBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** iPadOS moderno se anuncia como Mac; el táctil es lo que lo delata. */
function esIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function estaInstalada(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari en iOS no implementa display-mode y usa esta propiedad suya.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Aplana lo que devuelve el navegador a las columnas de `suscripciones_push`. */
function aFila(suscripcion: PushSubscription) {
  const json = suscripcion.toJSON();
  return {
    endpoint: suscripcion.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    navegador: navigator.userAgent.slice(0, 300),
  };
}

export function ActivarNotificaciones() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;

    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // En iPhone sin instalar no es falta de soporte, es falta de instalación.
        if (vigente) setEstado(esIOS() && !estaInstalada() ? "instalar" : "sin-soporte");
        return;
      }

      if (Notification.permission === "denied") {
        if (vigente) setEstado("bloqueado");
        return;
      }

      const registro = await navigator.serviceWorker.register("/sw.js");
      const suscripcion = await registro.pushManager.getSubscription();

      if (!vigente) return;

      if (!suscripcion) {
        setEstado("desactivado");
        return;
      }

      // Reafirma la fila por si el endpoint rotó desde la última vez.
      await guardarSuscripcion(aFila(suscripcion));
      if (vigente) setEstado("activado");
    })().catch(() => {
      if (vigente) setEstado("desactivado");
    });

    return () => {
      vigente = false;
    };
  }, []);

  const activar = useCallback(async () => {
    if (esIOS() && !estaInstalada()) {
      setEstado("instalar");
      toast.info("Falta instalar la app", {
        description:
          "En el iPhone: toca Compartir y luego «Añadir a pantalla de inicio». Abre la app desde ese icono y vuelve a intentarlo.",
        duration: 12000,
      });
      return;
    }

    setOcupado(true);
    try {
      const permiso = await Notification.requestPermission();

      if (permiso === "denied") {
        setEstado("bloqueado");
        toast.error("Avisos bloqueados", {
          description: "Actívalos desde los ajustes de este sitio en tu navegador.",
        });
        return;
      }
      if (permiso !== "granted") return;

      const registro = await navigator.serviceWorker.register("/sw.js");
      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: clavePublicaEnBytes(CLAVE_PUBLICA!),
      });

      const resultado = await guardarSuscripcion(aFila(suscripcion));
      if (!resultado.ok) {
        await suscripcion.unsubscribe();
        toast.error("No se activaron los avisos", { description: resultado.error });
        return;
      }

      setEstado("activado");
      toast.success("Listo", {
        description: "Te avisaremos cuando te asignen un pedido.",
      });
    } catch (e) {
      toast.error("No se activaron los avisos", {
        description: e instanceof Error ? e.message : "Vuelve a intentarlo.",
      });
    } finally {
      setOcupado(false);
    }
  }, []);

  const desactivar = useCallback(async () => {
    setOcupado(true);
    try {
      const registro = await navigator.serviceWorker.ready;
      const suscripcion = await registro.pushManager.getSubscription();
      if (suscripcion) {
        // Primero la base y después el navegador: si se cae en medio, queda una
        // fila muerta que la Edge Function borra al primer 410. Al revés quedaría
        // una fila viva sin dueño, mandando avisos a un navegador que no escucha.
        await borrarSuscripcion({ endpoint: suscripcion.endpoint });
        await suscripcion.unsubscribe();
      }
      setEstado("desactivado");
      toast.success("Avisos desactivados en este dispositivo");
    } finally {
      setOcupado(false);
    }
  }, []);

  // Sin clave pública configurada la función no está desplegada: un botón que
  // sólo puede fallar es peor que ningún botón.
  if (!CLAVE_PUBLICA) return null;
  if (estado === "cargando" || estado === "sin-soporte") return null;

  if (estado === "bloqueado") {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground size-8"
        onClick={() =>
          toast.info("Avisos bloqueados", {
            description:
              "Bloqueaste los avisos para este sitio. Actívalos desde los ajustes del navegador.",
          })
        }
        aria-label="Avisos bloqueados en este navegador"
      >
        <BellOff className="size-4" />
      </Button>
    );
  }

  const activado = estado === "activado";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={ocupado}
      onClick={activado ? desactivar : activar}
      aria-label={activado ? "Desactivar avisos en este dispositivo" : "Activar avisos"}
      title={activado ? "Avisos activados" : "Activar avisos"}
    >
      {activado ? <BellRing className="text-primary size-4" /> : <Bell className="size-4" />}
    </Button>
  );
}
