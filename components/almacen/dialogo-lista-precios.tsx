"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { DISENOS_LISTA, nombreArchivoLista, type DisenoLista } from "@/lib/lista-precios";
import { hoy } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const RECUERDA_DISENO = "lista-precios:diseno";

function disenoGuardado(): DisenoLista {
  try {
    const v = localStorage.getItem(RECUERDA_DISENO);
    return v && v in DISENOS_LISTA ? (v as DisenoLista) : "clasico";
  } catch {
    return "clasico";
  }
}

/** Una lista de casillas con "todos / ninguno". */
function Casillas({
  titulo,
  opciones,
  elegidas,
  alCambiar,
}: {
  titulo: string;
  opciones: { id: string; nombre: string }[];
  elegidas: Set<string>;
  alCambiar: (s: Set<string>) => void;
}) {
  if (!opciones.length) return null;
  const todas = opciones.every((o) => elegidas.has(o.id));
  return (
    <fieldset className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">{titulo}</legend>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => alCambiar(todas ? new Set() : new Set(opciones.map((o) => o.id)))}
        >
          {todas ? "Ninguno" : "Todos"}
        </Button>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {opciones.map((o) => (
          <li key={o.id}>
            <label className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <Checkbox
                checked={elegidas.has(o.id)}
                onCheckedChange={(v) => {
                  const s = new Set(elegidas);
                  if (v === true) s.add(o.id);
                  else s.delete(o.id);
                  alCambiar(s);
                }}
              />
              {o.nombre}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * Para descargar la lista de precios en PDF: qué materiales y qué categorías de
 * accesorios entran, y con qué diseño. El PDF lo arma el servidor con los
 * precios de Odoo de este momento.
 */
export function DialogoListaPrecios({
  materiales,
  categorias,
  alCerrar,
}: {
  materiales: string[];
  categorias: { id: string; nombre: string }[];
  alCerrar: () => void;
}) {
  const [mats, setMats] = useState(() => new Set(materiales));
  const [cats, setCats] = useState(() => new Set(categorias.map((c) => c.id)));
  const [diseno, setDiseno] = useState<DisenoLista>(disenoGuardado);
  const [descargando, setDescargando] = useState(false);
  const nada = mats.size === 0 && cats.size === 0;

  const descargar = async () => {
    setDescargando(true);
    try {
      localStorage.setItem(RECUERDA_DISENO, diseno);
    } catch {
      // Sin almacenamiento, la próxima vez vuelve al clásico.
    }
    try {
      const params = new URLSearchParams({ diseno, seleccion: "1" });
      for (const m of materiales) if (mats.has(m)) params.append("m", m);
      for (const c of categorias) if (cats.has(c.id)) params.append("c", c.id);
      const r = await fetch(`/almacen/lista-precios?${params}`);
      if (!r.ok) {
        toast.error("No se generó la lista", { description: (await r.text()) || `Error ${r.status}` });
        return;
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreArchivoLista(hoy());
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      alCerrar();
    } catch {
      toast.error("No se generó la lista", { description: "Revisa tu conexión e inténtalo de nuevo." });
    } finally {
      setDescargando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Lista de precios (PDF)</DialogTitle>
          <DialogDescription>
            Con los precios de venta de Odoo de este momento. Solo entran los productos activos que tienen precio. Las
            notas y los teléfonos se cambian en Configuración.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Diseño</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(DISENOS_LISTA) as DisenoLista[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={diseno === d}
                  onClick={() => setDiseno(d)}
                  className={cn(
                    "hover:bg-muted/50 rounded-lg border p-3 text-left transition-colors",
                    diseno === d && "border-primary ring-primary/30 bg-primary/5 ring-2",
                  )}
                >
                  <span className="block text-sm font-medium">{DISENOS_LISTA[d].nombre}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">{DISENOS_LISTA[d].descripcion}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <Casillas
            titulo="Planchas"
            opciones={materiales.map((m) => ({ id: m, nombre: m }))}
            elegidas={mats}
            alCambiar={setMats}
          />
          <Casillas titulo="Accesorios" opciones={categorias} elegidas={cats} alCambiar={setCats} />
          {!materiales.length && !categorias.length && (
            <p className="text-muted-foreground text-sm">No hay productos con precio. Revisa que Odoo esté conectado.</p>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button className="gap-1.5" onClick={descargar} disabled={descargando || nada}>
            <Download className="size-4" />
            {descargando ? "Generando…" : "Descargar PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
