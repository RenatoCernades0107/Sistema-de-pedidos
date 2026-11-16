"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import * as acciones from "@/app/(app)/almacen/acciones";
import { nombreDePlancha, valoresDe, type CategoriaAccesorio, type PlanchaInventario } from "@/lib/inventario";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leerPrecio } from "./comun";

type Tipo = "plancha" | "accesorio";

const numero = (t: string) => {
  const v = Number(t.trim().replace(",", "."));
  return t.trim() && Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * Crear una plancha o un accesorio que todavía no existe. Se crea en Odoo con el
 * código que sigue en el correlativo (PL0001 para planchas; el prefijo de su
 * categoría para accesorios: ACC055, PEG020) y aparece en el almacén. El precio
 * lo pone solo Administración: si lo crea Logística, queda en 0 hasta entonces.
 */
export function DialogoProducto({
  planchas,
  categorias,
  ponePrecio,
  alCerrar,
}: {
  planchas: PlanchaInventario[];
  categorias: CategoriaAccesorio[];
  ponePrecio: boolean;
  alCerrar: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>("plancha");
  // Plancha
  const [material, setMaterial] = useState("");
  const [variante, setVariante] = useState("");
  const [detalle, setDetalle] = useState("");
  const [espesor, setEspesor] = useState("");
  const [ancho, setAncho] = useState("122");
  const [largo, setLargo] = useState("183");
  const [rotable, setRotable] = useState(true);
  // Accesorio
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  // Los dos
  const [precio, setPrecio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const materiales = useMemo(() => valoresDe(planchas, "material"), [planchas]);
  const categoria = categorias.find((c) => c.id === categoriaId) ?? null;
  const espesorMm = numero(espesor);
  const anchoCm = numero(ancho);
  const largoCm = numero(largo);
  const vistaPrevia =
    tipo === "plancha" && material.trim() && espesorMm && anchoCm && largoCm
      ? nombreDePlancha({ material, variante, detalle, espesorMm, anchoCm, largoCm })
      : tipo === "accesorio" && nombre.trim()
        ? nombre.trim().toUpperCase()
        : null;

  const crear = () => {
    const p = ponePrecio ? leerPrecio(precio) : null;
    if (ponePrecio && precio.trim() && p === null) return setError("Escribe un precio válido.");
    let entrada: Record<string, unknown>;
    if (tipo === "plancha") {
      if (!material.trim()) return setError("Escribe el material.");
      if (!espesorMm) return setError("Escribe el espesor en milímetros.");
      if (!anchoCm || !largoCm) return setError("Escribe el ancho y el largo de la plancha en centímetros.");
      entrada = { tipo, material, variante, detalle, espesorMm, anchoCm, largoCm, rotable, precio: p };
    } else {
      if (!categoriaId) return setError("Elige la categoría.");
      if (nombre.trim().length < 3) return setError("Escribe el nombre del accesorio.");
      entrada = { tipo, categoriaId, nombre, precio: p };
    }
    iniciar(async () => {
      const r = await acciones.crearProducto(entrada);
      if (!r.ok) return setError(r.error);
      toast.success(`${r.codigo} creado en Odoo`, {
        description: ponePrecio ? "Ya puedes ingresarle stock." : "Administración tiene que ponerle el precio de venta.",
      });
      alCerrar();
    });
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nuevo producto</DialogTitle>
          <DialogDescription>
            Se crea en Odoo con el siguiente código de su serie. Para uno que ya existe en Odoo no hace falta: búscalo o
            agrégalo desde su pestaña.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            crear();
          }}
        >
          <Campo grupo label="Qué es">
            <Opciones
              valores={[tipo]}
              onToggle={(v) => {
                setTipo(v as Tipo);
                setError(null);
              }}
              opciones={[
                { valor: "plancha", label: "Plancha" },
                { valor: "accesorio", label: "Accesorio" },
              ]}
            />
          </Campo>

          {tipo === "plancha" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Material" requerido>
                  <Input value={material} onChange={(e) => setMaterial(e.target.value)} list="materiales-plancha" placeholder="Acrílico ECO" />
                  <datalist id="materiales-plancha">
                    {materiales.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Campo>
                <Campo label="Espesor (mm)" requerido>
                  <Input inputMode="decimal" value={espesor} onChange={(e) => setEspesor(e.target.value)} className="tnum" />
                </Campo>
                <Campo label="Variante" ayuda="Cristal, Blanco, Colores, Espejo…">
                  <Input value={variante} onChange={(e) => setVariante(e.target.value)} />
                </Campo>
                <Campo label="Color o detalle" ayuda="Rojo, Lechoso, Dorado… Cada color es su propio producto.">
                  <Input value={detalle} onChange={(e) => setDetalle(e.target.value)} />
                </Campo>
                <Campo label="Ancho (cm)" requerido>
                  <Input inputMode="decimal" value={ancho} onChange={(e) => setAncho(e.target.value)} className="tnum" />
                </Campo>
                <Campo label="Largo (cm)" requerido>
                  <Input inputMode="decimal" value={largo} onChange={(e) => setLargo(e.target.value)} className="tnum" />
                </Campo>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={rotable} onCheckedChange={(v) => setRotable(v === true)} />
                Las piezas se pueden girar al acomodarlas (no, si tiene veta o dibujo)
              </label>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
              <Campo grupo label="Categoría" requerido>
                <Select value={categoriaId} onValueChange={(v) => v && setCategoriaId(v)}>
                  <SelectTrigger aria-label="Categoría" className="w-full">
                    <SelectValue>{categoria ? `${categoria.nombre} (${categoria.prefijo})` : "Elige la categoría"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre} ({c.prefijo})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Nombre" requerido>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Bisagra cristal 30mm x 33mm" />
              </Campo>
            </div>
          )}

          {ponePrecio && (
            <Campo label="Precio de venta (S/)" ayuda="Vacío: 0, y se pone después." className="sm:w-48">
              <Input inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} className="tnum" />
            </Campo>
          )}

          {vistaPrevia && (
            <p className="bg-muted/40 rounded-lg border px-3 py-2 text-xs">
              En Odoo se llamará <span className="font-medium">{vistaPrevia}</span>
              {tipo === "accesorio" && categoria && <>, con código {categoria.prefijo}…</>}
              {tipo === "plancha" && <>, con código PL…</>}
            </p>
          )}
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={pendiente}>
              {pendiente ? "Creando…" : "Crear en Odoo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
