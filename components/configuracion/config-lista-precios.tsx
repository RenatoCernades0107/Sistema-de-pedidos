"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { guardarConfigListaPrecios } from "@/app/(app)/configuracion/acciones";
import {
  claveCategoria,
  claveMaterial,
  type ConfigListaPrecios,
  type ConfigSeccionLista,
} from "@/lib/lista-precios-config";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const VACIA: ConfigSeccionLista = { titulo: "", nota: "" };

/**
 * Lo que dice la lista de precios en PDF además de los precios: los teléfonos
 * de la cabecera, la nota del pie y, por cada material y categoría de
 * accesorios, un título y sus notas.
 */
export function FormConfigListaPrecios({
  config,
  materiales,
  categorias,
}: {
  config: ConfigListaPrecios;
  materiales: string[];
  categorias: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [telefonos, setTelefonos] = useState(config.telefonos);
  const [notaPie, setNotaPie] = useState(config.notaPie);
  const [secciones, setSecciones] = useState(config.secciones);
  const [guardando, iniciar] = useTransition();

  const sucio =
    telefonos !== config.telefonos ||
    notaPie !== config.notaPie ||
    JSON.stringify(secciones) !== JSON.stringify(config.secciones);

  const cambiar = (clave: string, cambios: Partial<ConfigSeccionLista>) =>
    setSecciones((s) => ({ ...s, [clave]: { ...VACIA, ...s[clave], ...cambios } }));

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarConfigListaPrecios({ telefonos, notaPie, secciones });
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success("Lista de precios guardada");
      router.refresh();
    });

  const seccion = (clave: string, nombre: string) => {
    const v = secciones[clave] ?? VACIA;
    return (
      <li key={clave} className="grid gap-3 border-t px-4 py-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">{nombre}</p>
          <Campo label="Título en el PDF" ayuda="Vacío: el nombre de arriba.">
            <Input value={v.titulo} placeholder={nombre} onChange={(e) => cambiar(clave, { titulo: e.target.value })} />
          </Campo>
        </div>
        <Campo label="Notas" ayuda="Una por renglón. La primera sale resaltada.">
          <Textarea
            rows={3}
            value={v.nota}
            placeholder={"Termoformable\n10 años de garantía"}
            onChange={(e) => cambiar(clave, { nota: e.target.value })}
          />
        </Campo>
      </li>
    );
  };

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (sucio) guardar();
      }}
    >
      <section className="bg-card rounded-xl border">
        <header className="bg-muted/40 border-b px-4 py-3">
          <h2 className="text-sm font-medium">Cabecera y pie</h2>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            La lista se descarga desde Almacén (botón “Lista de precios”), con los precios de venta de Odoo del momento.
          </p>
        </header>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Campo label="Teléfonos">
            <Input value={telefonos} placeholder="266-0505 / 946 107893" onChange={(e) => setTelefonos(e.target.value)} />
          </Campo>
          <Campo label="Nota del pie">
            <Input value={notaPie} onChange={(e) => setNotaPie(e.target.value)} />
          </Campo>
        </div>
      </section>

      <section className="bg-card rounded-xl border">
        <header className="bg-muted/40 px-4 py-3">
          <h2 className="text-sm font-medium">Planchas</h2>
        </header>
        <ul>{materiales.map((m) => seccion(claveMaterial(m), m))}</ul>
      </section>

      {categorias.length > 0 && (
        <section className="bg-card rounded-xl border">
          <header className="bg-muted/40 px-4 py-3">
            <h2 className="text-sm font-medium">Accesorios</h2>
          </header>
          <ul>{categorias.map((c) => seccion(claveCategoria(c.id), c.nombre))}</ul>
        </section>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={guardando || !sucio}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
