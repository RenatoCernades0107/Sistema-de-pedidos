"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelChat } from "./panel-chat";
import { PanelDiseno } from "./panel-diseno";

type Mitad = "chat" | "diseno";

/**
 * La pantalla partida de un diseño: el chat a la izquierda y el diseño a la
 * derecha. En el celular no caben los dos, así que se alterna entre uno y otro.
 *
 * Las dos mitades están siempre montadas y la que no toca solo se oculta: si se
 * desmontaran al cambiar de pestaña, el chat perdería lo que se está escribiendo
 * y el visor tendría que volver a cargar el modelo.
 */
export function VistaDiseno({
  disenoId,
  nombre,
  avisoMotor,
}: {
  disenoId: string;
  nombre: string;
  avisoMotor?: string | null;
}) {
  const [mitad, setMitad] = useState<Mitad>("chat");
  // El nombre puede llegar por el chat (el automático del primer mensaje).
  const [titulo, setTitulo] = useState(nombre);

  return (
    // El mismo alto fijo que el asistente de cotizaciones: la pantalla menos la
    // cabecera del shell y, en móvil, menos el hueco de las pestañas de abajo.
    <div className="flex h-[calc(100dvh-3.5rem-1px-5rem)] min-h-0 flex-col md:h-[calc(100dvh-3.5rem-1px)]">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <Button
          render={<Link href="/disenos" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-1.5"
        >
          <ArrowLeft />
          Diseños
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{titulo}</h1>

        <div role="tablist" aria-label="Qué se ve" className="bg-muted flex rounded-lg p-[3px] md:hidden">
          {(["chat", "diseno"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mitad === m}
              onClick={() => setMitad(m)}
              className={cn(
                "rounded-md px-2.5 py-0.5 text-sm font-medium transition-colors",
                mitad === m ? "bg-background text-foreground shadow-sm" : "text-foreground/60",
              )}
            >
              {m === "chat" ? "Chat" : "Diseño"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Chat con el asistente"
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col md:flex md:border-r",
            mitad === "chat" ? "flex" : "hidden",
          )}
        >
          <PanelChat disenoId={disenoId} onNombre={setTitulo} />
        </section>
        <section
          aria-label="Diseño"
          className={cn("min-h-0 min-w-0 flex-1 md:block", mitad === "diseno" ? "block" : "hidden")}
        >
          <PanelDiseno avisoMotor={avisoMotor} />
        </section>
      </div>
    </div>
  );
}
