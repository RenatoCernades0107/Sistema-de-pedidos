import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sin las variables de Odoo no se puede buscar ni crear: mejor decirlo antes de que alguien lo intente. */
export function AvisoOdoo({ className }: { className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "border-st-observado/30 bg-st-observado-soft text-st-observado flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">Falta conectar Odoo.</span> Para buscar clientes y productos y
        crear cotizaciones hay que cargar <code>ODOO_URL</code>, <code>ODOO_DB</code>,{" "}
        <code>ODOO_USUARIO</code> y <code>ODOO_API_KEY</code> en el servidor.
      </p>
    </div>
  );
}
