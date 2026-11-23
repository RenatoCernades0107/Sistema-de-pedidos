"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Circle } from "lucide-react";
import { LARGO_MAXIMO_PASSWORD, LARGO_MINIMO_PASSWORD, evaluarPassword, type NivelPassword } from "@/lib/fortaleza-password";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* Rojo = insegura, amarillo = falta algo, verde = segura. El texto de la etiqueta
   dice lo mismo que el color: la barra no puede ser lo único que lo diga. */
const ESTILO: Record<NivelPassword, { barra: string; texto: string; segmentos: number }> = {
  insegura: { barra: "bg-red-500", texto: "text-red-600 dark:text-red-400", segmentos: 1 },
  incompleta: { barra: "bg-amber-500", texto: "text-amber-700 dark:text-amber-400", segmentos: 2 },
  segura: { barra: "bg-green-600 dark:bg-green-500", texto: "text-green-700 dark:text-green-400", segmentos: 3 },
};

/**
 * El campo "Contraseña nueva" con su barra de seguridad, para los tres sitios donde
 * la persona elige una (bienvenida, cambio voluntario y recuperación).
 *
 * El `<input>` sigue siendo un campo de formulario normal (`name="password"`): la
 * Server Action lo lee del `FormData` y vuelve a validar con la misma regla. Que
 * aquí sea controlado es solo para pintar la barra mientras se escribe.
 */
export function CampoPasswordNueva({ autoFocus }: { autoFocus?: boolean }) {
  const [valor, setValor] = useState("");
  const entrada = useRef<HTMLInputElement>(null);
  const id = useId();
  const idAyuda = `${id}-ayuda`;

  // `form.reset()` (el cambio voluntario lo usa al guardar) vacía el DOM pero no
  // el estado de React: sin esto la barra seguiría pintando la contraseña de antes.
  useEffect(() => {
    const formulario = entrada.current?.form;
    if (!formulario) return;
    const vaciar = () => setValor("");
    formulario.addEventListener("reset", vaciar);
    return () => formulario.removeEventListener("reset", vaciar);
  }, []);

  const { nivel, requisitos, etiqueta, motivo } = evaluarPassword(valor);
  const estilo = ESTILO[nivel];
  const escribiendo = valor.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="password">Contraseña nueva</Label>
      <Input
        ref={entrada}
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={LARGO_MINIMO_PASSWORD}
        maxLength={LARGO_MAXIMO_PASSWORD}
        autoFocus={autoFocus}
        required
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        aria-describedby={idAyuda}
      />

      <div id={idAyuda} className="flex flex-col gap-2">
        {/* Tres tramos: se llenan según el nivel. Vacíos mientras no se escribe nada. */}
        <div
          role="meter"
          aria-label="Seguridad de la contraseña"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={escribiendo ? estilo.segmentos : 0}
          aria-valuetext={escribiendo ? etiqueta : "Sin escribir"}
          className="flex gap-1"
        >
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                escribiendo && n <= estilo.segmentos ? estilo.barra : "bg-muted",
              )}
            />
          ))}
        </div>

        <p aria-live="polite" className={cn("text-xs font-medium", escribiendo ? estilo.texto : "text-muted-foreground")}>
          {escribiendo ? (motivo ? `${etiqueta}. ${motivo}.` : `${etiqueta}.`) : "Elige una contraseña segura."}
        </p>

        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          {requisitos.map((r) => (
            <li key={r.clave} className={cn("flex items-center gap-1.5", r.cumple && "text-foreground")}>
              {r.cumple ? (
                <Check className="size-3 shrink-0 text-green-600 dark:text-green-500" />
              ) : (
                <Circle className="size-3 shrink-0" />
              )}
              {r.texto}
              <span className="sr-only">{r.cumple ? " (cumplido)" : " (falta)"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
