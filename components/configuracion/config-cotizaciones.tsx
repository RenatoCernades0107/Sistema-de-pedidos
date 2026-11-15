"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { guardarConfigCotizaciones } from "@/app/(app)/configuracion/acciones";
import { textoValidez, type ConfigCotizaciones } from "@/lib/cotizaciones-config";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";

/**
 * Lo que se ajusta de las cotizaciones: por ahora, cuántos días valen. Es lo
 * que dice el PDF y el texto que recibe el cliente.
 */
export function FormConfigCotizaciones({ config }: { config: ConfigCotizaciones }) {
  const router = useRouter();
  const [dias, setDias] = useState(String(config.validezDias));
  const [guardando, iniciar] = useTransition();
  const sucio = dias.trim() !== String(config.validezDias);
  const valido = /^\d+$/.test(dias.trim()) && Number(dias) >= 1 && Number(dias) <= 365;

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarConfigCotizaciones({ validezDias: dias.trim() });
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success("Configuración de cotizaciones guardada");
      router.refresh();
    });

  return (
    <section className="bg-card max-w-xl rounded-xl border">
      <header className="bg-muted/40 border-b px-4 py-3">
        <h2 className="text-sm font-medium">Validez de la cotización</h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          Cuántos días vale una cotización desde que se emite. Aparece en el PDF y en el texto que se le envía al
          cliente. El PDF se genera cada vez que se abre, así que el cambio también se ve en las cotizaciones ya
          enviadas.
        </p>
      </header>
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (sucio && valido) guardar();
        }}
      >
        <Campo
          label="Días de validez"
          ayuda={valido ? `Ejemplo de hoy: ${textoValidez(new Date().toISOString(), Number(dias))}` : undefined}
          error={dias.trim() && !valido ? "Escribe un número entero de días, de 1 a 365." : undefined}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            step={1}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className="tnum w-32"
          />
        </Campo>
        <div className="flex items-center justify-end gap-3">
          <Button type="submit" disabled={guardando || !sucio || !valido}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </section>
  );
}
