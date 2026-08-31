"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Qué icono toca lo decide el CSS y no un `useState` que se enciende al montar:
 * `next-themes` pone la clase `dark` en el `<html>` antes de que se pinte nada,
 * así que las dos variantes pueden ir en el marcado y esconderse con `dark:`.
 * Sale gratis lo que el truco del montaje costaba: ni parpadeo del icono en la
 * primera carga ni desajuste de hidratación.
 *
 * La etiqueta tampoco depende del tema. Un botón que cambia de nombre al pulsarlo
 * obliga a releerlo para saber si pasó algo; "Cambiar de tema" dice lo que hace en
 * los dos sentidos.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Cambiar de tema"
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
