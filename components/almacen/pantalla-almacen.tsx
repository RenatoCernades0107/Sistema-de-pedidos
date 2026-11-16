"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CircleAlert, PackagePlus, Plus, Warehouse } from "lucide-react";
import { TIPOS_ALMACEN } from "@/lib/almacenes";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { IngresoResumen } from "@/lib/inventario";
import type { Sobrante } from "@/lib/sobrantes";
import type { Inventario } from "@/lib/stock-servidor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PantallaSobrantes } from "@/components/sobrantes/pantalla-sobrantes";
import type { PermisosAlmacen } from "./comun";
import { DialogoAlmacenes } from "./dialogo-almacenes";
import { DialogoIngreso, ingresables } from "./dialogo-ingreso";
import { DialogoProducto } from "./dialogo-producto";
import { ListaIngresos } from "./lista-ingresos";
import { TablaAccesorios } from "./tabla-accesorios";
import { TablaPlanchas } from "./tabla-planchas";

export type Vista = "planchas" | "accesorios" | "sobrantes" | "ingresos";

/**
 * El almacén: el stock de planchas y accesorios en cada almacén, los sobrantes
 * y los ingresos. La pestaña va en la URL (`?vista=`) para que un enlace o una
 * recarga abran la misma.
 */
export function PantallaAlmacen({
  vista: inicial,
  inventario,
  sobrantes,
  preciosSobrantes,
  catalogo,
  ingresos,
  permisos,
  odooConectado,
}: {
  vista: Vista;
  inventario: Inventario;
  sobrantes: Sobrante[];
  preciosSobrantes: Record<string, number | null>;
  catalogo: GrupoPlancha[];
  ingresos: IngresoResumen[];
  permisos: PermisosAlmacen;
  odooConectado: boolean;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const [vista, setVista] = useState<Vista>(inicial);
  const [dialogo, setDialogo] = useState<"ingreso" | "producto" | "almacenes" | null>(null);
  const { almacenes, planchas, accesorios, categorias, errorOdoo, hayFuera } = inventario;
  const activos = almacenes.filter((a) => a.activo);
  const productos = useMemo(() => ingresables(planchas, accesorios), [planchas, accesorios]);

  const cambiarVista = (v: Vista) => {
    setVista(v);
    router.replace(`${ruta}?vista=${v}`, { scroll: false });
  };

  const sobrantesEn = (id: string) =>
    sobrantes.filter((s) => s.almacenId === id && (s.estado === "disponible" || s.estado === "reservado")).length;

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Almacén</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Lo que hay de cada plancha y cada accesorio en cada almacén, según Odoo, y los sobrantes.
            {!permisos.gestionarStock && " Puedes verlo; lo cambian Administración y Logística."}
          </p>
        </div>
        {permisos.gestionarStock && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => setDialogo("almacenes")}>
              <Warehouse className="size-4" />
              Almacenes
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setDialogo("producto")} disabled={!odooConectado}>
              <Plus className="size-4" />
              Nuevo producto
            </Button>
            <Button className="gap-1.5" onClick={() => setDialogo("ingreso")} disabled={!odooConectado}>
              <PackagePlus className="size-4" />
              Ingresar stock
            </Button>
          </div>
        )}
      </header>

      <ul className="mb-4 flex flex-wrap gap-2" aria-label="Almacenes">
        {activos.map((a) => (
          <li key={a.id} className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <Warehouse className="text-muted-foreground size-3.5" />
            <span className="font-medium">{a.nombre}</span>
            <span className="text-muted-foreground text-xs">
              {TIPOS_ALMACEN[a.tipo]} · {a.codigo} · {sobrantesEn(a.id)} {sobrantesEn(a.id) === 1 ? "sobrante" : "sobrantes"}
            </span>
            {!a.odooWarehouseId && (
              <span className="text-st-observado text-xs" title={a.errorSincronizacion ?? undefined}>
                · no está en Odoo
              </span>
            )}
          </li>
        ))}
      </ul>

      {(!odooConectado || errorOdoo) && (
        <p className="border-st-observado/25 bg-st-observado-soft mb-4 flex gap-2 rounded-xl border p-3 text-sm">
          <CircleAlert className="text-st-observado mt-0.5 size-4 shrink-0" />
          <span>
            {!odooConectado
              ? "Falta conectar Odoo: el catálogo se ve, pero sin stock ni precios, y no se puede ingresar stock."
              : `Odoo no respondió del todo: ${errorOdoo}`}
          </span>
        </p>
      )}
      {hayFuera && (
        <p className="bg-muted/40 mb-4 flex gap-2 rounded-xl border p-3 text-sm">
          <CircleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span>
            Hay stock en Odoo fuera de estos almacenes (columna <span className="font-medium">Anterior</span>: el almacén
            que Odoo traía). Cuéntalo y regístralo con un ajuste en el almacén donde está de verdad; cuando los pedidos
            abiertos terminen, el anterior se vacía en Odoo.
          </span>
        </p>
      )}

      <Tabs value={vista} onValueChange={(v) => cambiarVista(v as Vista)}>
        <TabsList className="mb-4">
          <TabsTrigger value="planchas">Planchas</TabsTrigger>
          <TabsTrigger value="accesorios">Accesorios</TabsTrigger>
          <TabsTrigger value="sobrantes">Sobrantes</TabsTrigger>
          {permisos.gestionarStock && <TabsTrigger value="ingresos">Ingresos</TabsTrigger>}
        </TabsList>
        <TabsContent value="planchas">
          <TablaPlanchas planchas={planchas} almacenes={almacenes} permisos={permisos} conFuera={hayFuera} />
        </TabsContent>
        <TabsContent value="accesorios">
          <TablaAccesorios
            accesorios={accesorios}
            categorias={categorias}
            almacenes={almacenes}
            permisos={permisos}
            conFuera={hayFuera}
          />
        </TabsContent>
        <TabsContent value="sobrantes">
          <PantallaSobrantes
            sobrantes={sobrantes}
            catalogo={catalogo}
            almacenes={almacenes}
            precios={preciosSobrantes}
            permisos={permisos}
            odooConectado={odooConectado}
          />
        </TabsContent>
        {permisos.gestionarStock && (
          <TabsContent value="ingresos">
            <ListaIngresos ingresos={ingresos} />
          </TabsContent>
        )}
      </Tabs>

      {dialogo === "ingreso" && (
        <DialogoIngreso almacenes={almacenes} productos={productos} alCerrar={() => setDialogo(null)} />
      )}
      {dialogo === "producto" && (
        <DialogoProducto
          planchas={planchas}
          categorias={categorias}
          ponePrecio={permisos.editarPrecios}
          alCerrar={() => setDialogo(null)}
        />
      )}
      {dialogo === "almacenes" && <DialogoAlmacenes almacenes={almacenes} alCerrar={() => setDialogo(null)} />}
    </div>
  );
}
