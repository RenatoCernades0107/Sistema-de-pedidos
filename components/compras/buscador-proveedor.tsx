"use client";

import { useEffect, useState } from "react";
import { buscarProveedores } from "@/app/(app)/compras/acciones";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { ComboBusqueda } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";

/** El proveedor de una compra: un contacto de Odoo. */
export function BuscadorProveedor({
  proveedor,
  alElegir,
  bloqueado,
}: {
  proveedor: ClienteOdoo | null;
  alElegir: (p: ClienteOdoo | null) => void;
  bloqueado?: boolean;
}) {
  const [consulta, setConsulta] = useState("");
  const [estado, setEstado] = useState<{ q: string; lista: ClienteOdoo[]; error: string | null } | null>(null);

  useEffect(() => {
    const q = consulta.trim();
    if (q.length < 2) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await buscarProveedores(q);
      if (!vigente) return;
      setEstado(r.ok ? { q, lista: r.proveedores, error: null } : { q, lista: [], error: r.error });
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [consulta]);

  if (proveedor) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">Proveedor</p>
        <p className="bg-muted/50 flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm">
          <span className="min-w-0 flex-1 font-medium">{proveedor.nombre}</span>
          {proveedor.documento && <span className="text-muted-foreground text-xs">{proveedor.documento}</span>}
          {!bloqueado && (
            <Button type="button" variant="ghost" size="xs" onClick={() => alElegir(null)}>
              Cambiar
            </Button>
          )}
        </p>
      </div>
    );
  }

  const fresco = estado?.q === consulta.trim();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium">
        Proveedor <span className="text-destructive">*</span>
      </p>
      <ComboBusqueda
        etiqueta="Buscar proveedor"
        placeholder="Nombre o RUC del proveedor"
        consulta={consulta}
        alEscribir={setConsulta}
        opciones={(fresco ? estado!.lista : []).map((p) => ({
          valor: String(p.id),
          alElegir: () => alElegir(p),
          contenido: (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="min-w-0 truncate">{p.nombre}</span>
              {p.documento && <span className="text-muted-foreground ml-auto text-xs">{p.documento}</span>}
            </span>
          ),
        }))}
        cargando={consulta.trim().length >= 2 && !fresco}
        error={fresco ? estado!.error : null}
        vacio={consulta.trim().length < 2 ? "Escribe al menos dos letras." : "Ningún contacto de Odoo coincide."}
        fresco={fresco}
      />
    </div>
  );
}
