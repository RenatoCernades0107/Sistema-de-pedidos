"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { guardarConfigCortes } from "@/app/(app)/configuracion/acciones";
import { FRACCIONES_ESTANDAR, type ConfigCortes } from "@/lib/cortes/config";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

/**
 * Los parámetros del cálculo de cortes. Todo se edita como texto y se valida en
 * el servidor al guardar: aquí conviven muchos números a medio escribir y
 * validar cada tecla estorbaría.
 */

type Fila = Record<string, string>;

interface Borrador {
  laser: { tabla: Fila[]; factorVelocidad: string; overheadPorPieza: string; costoPorMinuto: string; igvPct: string };
  manual: Fila[];
  recargoPct: string;
  /** Los nombres de las fracciones estándar encendidas. */
  fracciones: string[];
  redondearAlSol: boolean;
  corte: { kerfLaser: string; kerfManual: string; margen: string; retazoMin: string };
  servicios: { laser: string; manual: string };
}

const t = (n: number) => String(n);

/** El texto de cada casilla de fracción, de la más grande a la más chica. */
const ETIQUETAS_FRACCION: [nombre: string, texto: string][] = [
  ["3/4", "Tres cuartos"],
  ["1/2", "Media plancha"],
  ["1/4", "Cuarto de plancha"],
  ["1/8", "Octavo de plancha"],
  ["1/16", "Dieciseisavo de plancha"],
];

const esEstandar = (factor: number) => FRACCIONES_ESTANDAR.some((f) => Math.abs(f.factor - factor) < 1e-9);

function aBorrador(c: ConfigCortes): Borrador {
  return {
    laser: {
      tabla: c.laser.tabla.map((f) => ({
        mm: t(f.mm),
        velocidad: t(f.velocidad),
        pierce: t(f.pierce),
        pasadas: t(f.pasadas),
      })),
      factorVelocidad: t(c.laser.factorVelocidad),
      overheadPorPieza: t(c.laser.overheadPorPieza),
      costoPorMinuto: t(c.laser.costoPorMinuto),
      igvPct: t(c.laser.igvPct),
    },
    manual: c.manual.precios.map((p) => ({ mm: t(p.mm), precio: t(p.precio) })),
    recargoPct: t(c.cobro.recargoPct),
    fracciones: FRACCIONES_ESTANDAR.filter((e) =>
      c.cobro.fracciones.some((f) => Math.abs(f.factor - e.factor) < 1e-9),
    ).map((e) => e.nombre),
    redondearAlSol: c.cobro.redondearAlSol,
    corte: {
      kerfLaser: t(c.corte.kerfLaser),
      kerfManual: t(c.corte.kerfManual),
      margen: t(c.corte.margen),
      retazoMin: t(c.corte.retazoMin),
    },
    servicios: { ...c.servicios },
  };
}

/** Las fracciones que la pantalla no conoce (tiras, por ejemplo) se conservan tal cual. */
function aConfig(b: Borrador, original: ConfigCortes) {
  const otras = original.cobro.fracciones.filter((f) => !esEstandar(f.factor));
  const elegidas = FRACCIONES_ESTANDAR.filter((f) => b.fracciones.includes(f.nombre));
  return {
    laser: { ...b.laser, tabla: b.laser.tabla.filter((f) => f.mm.trim() !== "") },
    manual: { precios: b.manual.filter((f) => f.mm.trim() !== "") },
    cobro: {
      recargoPct: b.recargoPct,
      fracciones: [...elegidas, ...otras],
      redondearAlSol: b.redondearAlSol,
    },
    corte: b.corte,
    servicios: b.servicios,
  };
}

export function FormConfigCortes({ config }: { config: ConfigCortes }) {
  const router = useRouter();
  const [b, setB] = useState(() => aBorrador(config));
  const [sucio, setSucio] = useState(false);
  const [guardando, iniciar] = useTransition();

  const cambiar = (cambio: (previo: Borrador) => Borrador) => {
    setB(cambio);
    setSucio(true);
  };

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarConfigCortes(aConfig(b, config));
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success("Configuración de cortes guardada");
      setSucio(false);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <Seccion
        titulo="Corte manual"
        descripcion="Se cobra por pieza, según el espesor. Solo se puede cotizar corte manual en los espesores de esta tabla: agrega una fila para las excepciones."
      >
        <TablaEditable
          nombre="corte manual"
          columnas={[
            { clave: "mm", titulo: "Espesor", sufijo: "mm" },
            { clave: "precio", titulo: "Precio por pieza", prefijo: "S/" },
          ]}
          filas={b.manual}
          alCambiar={(manual) => cambiar((p) => ({ ...p, manual }))}
          nueva={{ mm: "", precio: "" }}
        />
      </Seccion>

      <Seccion
        titulo="Corte láser"
        descripcion="Se cobra por el tiempo de máquina: el contorno de cada pieza entre la velocidad a ese espesor. Entre dos espesores de la tabla, la velocidad se interpola."
      >
        <TablaEditable
          nombre="corte láser"
          columnas={[
            { clave: "mm", titulo: "Espesor", sufijo: "mm" },
            { clave: "velocidad", titulo: "Velocidad", sufijo: "mm/s" },
            { clave: "pierce", titulo: "Perforación", sufijo: "s" },
            { clave: "pasadas", titulo: "Pasadas" },
          ]}
          filas={b.laser.tabla}
          alCambiar={(tabla) => cambiar((p) => ({ ...p, laser: { ...p.laser, tabla } }))}
          nueva={{ mm: "", velocidad: "", pierce: "0.1", pasadas: "1" }}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            label="Costo por minuto"
            prefijo="S/"
            valor={b.laser.costoPorMinuto}
            alCambiar={(v) => cambiar((p) => ({ ...p, laser: { ...p.laser, costoPorMinuto: v } }))}
          />
          <Numero
            label="IGV sobre el servicio"
            sufijo="%"
            ayuda="0 si el costo por minuto ya lo incluye."
            valor={b.laser.igvPct}
            alCambiar={(v) => cambiar((p) => ({ ...p, laser: { ...p.laser, igvPct: v } }))}
          />
          <Numero
            label="Rendimiento real"
            ayuda="0.9 = la máquina rinde el 90 % de la velocidad de la tabla."
            valor={b.laser.factorVelocidad}
            alCambiar={(v) => cambiar((p) => ({ ...p, laser: { ...p.laser, factorVelocidad: v } }))}
          />
          <Numero
            label="Tiempo extra por pieza"
            sufijo="s"
            ayuda="Posicionar y encender."
            valor={b.laser.overheadPorPieza}
            alCambiar={(v) => cambiar((p) => ({ ...p, laser: { ...p.laser, overheadPorPieza: v } }))}
          />
        </div>
      </Seccion>

      <Seccion
        titulo="Cobro del material"
        descripcion="Si las piezas caben en un pedazo de la plancha, se cobra ese pedazo con un recargo y el resto queda en el almacén. Si no caben, se cobra la plancha completa."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            label="Recargo por fracción"
            sufijo="%"
            ayuda="Media plancha a S/ 100 con 20 % sale S/ 60."
            valor={b.recargoPct}
            alCambiar={(v) => cambiar((p) => ({ ...p, recargoPct: v }))}
          />
          <Campo grupo label="Fracciones que se venden" className="sm:col-span-2 lg:col-span-3">
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1.5">
              {ETIQUETAS_FRACCION.map(([nombre, texto]) => (
                <Casilla
                  key={nombre}
                  marcada={b.fracciones.includes(nombre)}
                  alCambiar={(v) =>
                    cambiar((p) => ({
                      ...p,
                      fracciones: v
                        ? [...p.fracciones.filter((x) => x !== nombre), nombre]
                        : p.fracciones.filter((x) => x !== nombre),
                    }))
                  }
                  texto={`${texto} (${nombre})`}
                />
              ))}
            </div>
          </Campo>
          <Campo grupo label="Redondeo" className="sm:col-span-2 lg:col-span-4">
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1.5">
              <Casilla
                marcada={b.redondearAlSol}
                alCambiar={(v) => cambiar((p) => ({ ...p, redondearAlSol: v }))}
                texto="Redondear el total del corte al sol, hacia arriba"
              />
            </div>
          </Campo>
        </div>
      </Seccion>

      <Seccion
        titulo="Al cortar"
        descripcion="Lo que la herramienta se come en cada corte y lo que no se aprovecha. Con 0 las piezas se acomodan pegadas, como hasta ahora."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            label="Grosor del corte láser"
            sufijo="cm"
            valor={b.corte.kerfLaser}
            alCambiar={(v) => cambiar((p) => ({ ...p, corte: { ...p.corte, kerfLaser: v } }))}
          />
          <Numero
            label="Grosor del corte manual"
            sufijo="cm"
            ayuda="La sierra come unos 0.3 cm."
            valor={b.corte.kerfManual}
            alCambiar={(v) => cambiar((p) => ({ ...p, corte: { ...p.corte, kerfManual: v } }))}
          />
          <Numero
            label="Borde que se descarta"
            sufijo="cm"
            ayuda="Por cada lado de la plancha."
            valor={b.corte.margen}
            alCambiar={(v) => cambiar((p) => ({ ...p, corte: { ...p.corte, margen: v } }))}
          />
          <Numero
            label="Sobrante mínimo"
            sufijo="cm"
            ayuda="Con un lado más corto es retazo y no vuelve al stock."
            valor={b.corte.retazoMin}
            alCambiar={(v) => cambiar((p) => ({ ...p, corte: { ...p.corte, retazoMin: v } }))}
          />
        </div>
      </Seccion>

      <Seccion
        titulo="Servicios en Odoo"
        descripcion="El código del producto de Odoo con el que se factura cada tipo de corte."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Corte láser">
            <Input
              value={b.servicios.laser}
              onChange={(e) => cambiar((p) => ({ ...p, servicios: { ...p.servicios, laser: e.target.value } }))}
              className="font-mono"
            />
          </Campo>
          <Campo label="Corte manual">
            <Input
              value={b.servicios.manual}
              onChange={(e) => cambiar((p) => ({ ...p, servicios: { ...p.servicios, manual: e.target.value } }))}
              className="font-mono"
            />
          </Campo>
        </div>
      </Seccion>

      <div className="bg-background/90 sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t px-4 py-3 backdrop-blur-md md:bottom-0 md:-mx-6 md:px-6">
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs" aria-live="polite">
            {sucio
              ? "Hay cambios sin guardar. Valen para las cotizaciones y pedidos que se hagan desde ahora."
              : "Sin cambios."}
          </p>
          <Button onClick={guardar} disabled={guardando || !sucio}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Seccion({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <header className="bg-muted/40 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{titulo}</h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{descripcion}</p>
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

function Casilla({
  marcada,
  alCambiar,
  texto,
}: {
  marcada: boolean;
  alCambiar: (v: boolean) => void;
  texto: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <Checkbox checked={marcada} onCheckedChange={(v) => alCambiar(v === true)} />
      {texto}
    </label>
  );
}

function Numero({
  label,
  valor,
  alCambiar,
  prefijo,
  sufijo,
  ayuda,
}: {
  label: string;
  valor: string;
  alCambiar: (v: string) => void;
  prefijo?: string;
  sufijo?: string;
  ayuda?: string;
}) {
  return (
    <Campo label={label} ayuda={ayuda}>
      <ConUnidad prefijo={prefijo} sufijo={sufijo}>
        <Input
          inputMode="decimal"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          className={`tnum ${prefijo ? "pl-8" : ""} ${sufijo ? "pr-12" : ""}`}
        />
      </ConUnidad>
    </Campo>
  );
}

function ConUnidad({
  prefijo,
  sufijo,
  children,
}: {
  prefijo?: string;
  sufijo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {prefijo && (
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs">
          {prefijo}
        </span>
      )}
      {children}
      {sufijo && (
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs">
          {sufijo}
        </span>
      )}
    </div>
  );
}

interface Columna {
  clave: string;
  titulo: string;
  prefijo?: string;
  sufijo?: string;
}

/** Una tabla de números con filas que se agregan y se quitan. */
function TablaEditable({
  nombre,
  columnas,
  filas,
  alCambiar,
  nueva,
}: {
  nombre: string;
  columnas: Columna[];
  filas: Fila[];
  alCambiar: (filas: Fila[]) => void;
  nueva: Fila;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              {columnas.map((c) => (
                <th key={c.clave} className="pr-2 pb-1.5 font-medium">
                  {c.titulo}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => (
              <tr key={i}>
                {columnas.map((c) => (
                  <td key={c.clave} className="py-1 pr-2">
                    <ConUnidad prefijo={c.prefijo} sufijo={c.sufijo}>
                      <Input
                        inputMode="decimal"
                        aria-label={`${c.titulo}, fila ${i + 1} de ${nombre}`}
                        value={fila[c.clave] ?? ""}
                        onChange={(e) =>
                          alCambiar(filas.map((f, j) => (j === i ? { ...f, [c.clave]: e.target.value } : f)))
                        }
                        className={`tnum min-w-24 ${c.prefijo ? "pl-8" : ""} ${c.sufijo ? "pr-12" : ""}`}
                      />
                    </ConUnidad>
                  </td>
                ))}
                <td className="py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-8"
                    aria-label={`Quitar la fila ${i + 1} de ${nombre}`}
                    onClick={() => alCambiar(filas.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length === 0 && (
        <p className="text-muted-foreground text-sm">Sin filas todavía.</p>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => alCambiar([...filas, nueva])}>
          <Plus className="size-3.5" />
          Agregar espesor
        </Button>
      </div>
    </div>
  );
}
