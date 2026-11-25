"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { guardarConfigEmpresa } from "@/app/(app)/configuracion/acciones";
import { esquemaConfigEmpresa, type ConfigEmpresa } from "@/lib/empresa-config";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const CAMPOS: { clave: keyof ConfigEmpresa; label: string; ayuda?: string; placeholder?: string; largo?: boolean }[] = [
  { clave: "direccion", label: "Dirección", placeholder: "Av. … 123" },
  { clave: "referencia", label: "Referencia", placeholder: "Frente a…, a media cuadra de…" },
  { clave: "distrito", label: "Distrito y ciudad", placeholder: "Cercado de Lima, Lima" },
  {
    clave: "mapsUrl",
    label: "Enlace de Google Maps",
    ayuda: "El agente lo comparte cuando le preguntan cómo llegar.",
    placeholder: "https://maps.app.goo.gl/…",
  },
  {
    clave: "horario",
    label: "Horario de atención",
    placeholder: "Lunes a viernes de 9:00 a 18:00 · sábados de 9:00 a 13:00",
    largo: true,
  },
  { clave: "telefono", label: "Teléfono de la tienda", placeholder: "01 …" },
];

/**
 * Dónde está la empresa y cuándo atiende. Lo usa el agente de WhatsApp para
 * responder "¿dónde están?", "¿hasta qué hora atienden?".
 */
export function FormDatosEmpresa({ config }: { config: ConfigEmpresa }) {
  const router = useRouter();
  const [valores, setValores] = useState<ConfigEmpresa>(config);
  const [guardando, iniciar] = useTransition();
  const sucio = (Object.keys(config) as (keyof ConfigEmpresa)[]).some((k) => valores[k].trim() !== config[k]);
  const validacion = esquemaConfigEmpresa.safeParse(valores);
  const errores = new Map(
    validacion.success ? [] : validacion.error.issues.map((i) => [String(i.path[0]), i.message] as const),
  );

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarConfigEmpresa(valores);
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success("Datos de la empresa guardados");
      router.refresh();
    });

  return (
    <section className="bg-card max-w-xl rounded-xl border">
      <header className="bg-muted/40 border-b px-4 py-3">
        <h2 className="text-sm font-medium">Datos de la empresa</h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          Dónde está la tienda y cuándo atiende. El agente de WhatsApp los usa cuando un cliente pregunta cómo
          llegar; las formas de pago salen de las cuentas bancarias vigentes que se muestran en el PDF.
        </p>
      </header>
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (sucio && validacion.success) guardar();
        }}
      >
        {CAMPOS.map((c) => (
          <Campo key={c.clave} label={c.label} ayuda={c.ayuda} error={errores.get(c.clave)}>
            {c.largo ? (
              <Textarea
                value={valores[c.clave]}
                placeholder={c.placeholder}
                rows={2}
                onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
              />
            ) : (
              <Input
                value={valores[c.clave]}
                placeholder={c.placeholder}
                onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
              />
            )}
          </Campo>
        ))}
        <div className="flex items-center justify-end gap-3">
          <Button type="submit" disabled={guardando || !sucio || !validacion.success}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </section>
  );
}
