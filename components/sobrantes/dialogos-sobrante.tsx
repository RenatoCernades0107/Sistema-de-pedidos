"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import * as acciones from "@/app/(app)/sobrantes/acciones";
import {
  buscarGrupos,
  colorDe,
  espesorTexto,
  medidaDe,
  nombreDeGrupo,
  pideColor,
  type GrupoPlancha,
} from "@/lib/cortes/catalogo";
import { esEstandar, medidaSobrante, normalizarMedidas, type Sobrante } from "@/lib/sobrantes";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
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

const numero = (t: string) => {
  const v = Number(t.trim().replace(",", "."));
  return t.trim() && Number.isFinite(v) ? v : null;
};

/**
 * Registrar a mano un sobrante que ya está en el almacén: de qué material es,
 * cuánto mide y dónde se guardó. La app crea su lote en Odoo con una unidad en
 * stock, y después se imprime la etiqueta.
 */
export function DialogoRegistrarSobrante({
  abierto,
  alCambiar,
  catalogo,
  alRegistrar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  catalogo: GrupoPlancha[];
  alRegistrar: (codigo: string) => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar sobrante</DialogTitle>
          <DialogDescription>
            Mide el pedazo y anota dónde lo guardas. Se crea en Odoo como un lote con su etiqueta.
          </DialogDescription>
        </DialogHeader>
        {abierto && (
          <Formulario
            catalogo={catalogo}
            alTerminar={(codigo) => {
              alCambiar(false);
              alRegistrar(codigo);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({ catalogo, alTerminar }: { catalogo: GrupoPlancha[]; alTerminar: (codigo: string) => void }) {
  const [consulta, setConsulta] = useState("");
  const [grupo, setGrupo] = useState<GrupoPlancha | null>(null);
  const [color, setColor] = useState("");
  const [largo, setLargo] = useState("");
  const [ancho, setAncho] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const opciones: Opcion[] = useMemo(
    () =>
      buscarGrupos(catalogo, consulta).map((g) => ({
        valor: g.id,
        alElegir: () => {
          setGrupo(g);
          setError(null);
        },
        contenido: (
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{g.material}</span>
            <span>{colorDe(g)}</span>
            <span className="tnum">{espesorTexto(g.espesorMm)}</span>
            <span className="text-muted-foreground ml-auto text-xs">{g.formatos.map(medidaDe).join(" · ")}</span>
          </span>
        ),
      })),
    [catalogo, consulta],
  );

  const l = numero(largo);
  const a = numero(ancho);
  const medidas = l && a && l > 0 && a > 0 ? normalizarMedidas(l, a) : null;
  const estandar = grupo && medidas ? esEstandar(medidas, grupo.formatos) : false;
  const conColor = grupo ? pideColor(grupo) : false;

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!grupo) return setError("Elige el material.");
    if (conColor && !color.trim()) return setError("Escribe el color de la pieza.");
    if (!medidas) return setError("Escribe el largo y el ancho en centímetros.");
    setError(null);
    iniciar(async () => {
      const r = await acciones.registrarSobrante({
        grupoId: grupo.id,
        color: conColor ? color : null,
        largo: medidas.largo,
        ancho: medidas.ancho,
        ubicacion,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.aviso) toast.warning("Falta Odoo", { description: r.aviso, duration: 12_000 });
      alTerminar(r.codigo!);
    });
  };

  return (
    <form onSubmit={enviar} className="flex min-h-0 flex-col gap-4" noValidate>
      <div className="flex flex-col gap-4 overflow-y-auto">
        {grupo ? (
          <div>
            <p className="text-xs font-medium">Material</p>
            <p
              className="bg-muted/50 mt-1.5 flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm"
              data-testid="material-sobrante"
            >
              <span className="min-w-0 flex-1 font-medium">{nombreDeGrupo(grupo)}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setGrupo(null)}>
                Cambiar
              </Button>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">Material</p>
            <ComboBusqueda
              etiqueta="Buscar material"
              placeholder="Material, color y espesor: eco cristal 3…"
              consulta={consulta}
              alEscribir={setConsulta}
              opciones={opciones}
              cargando={false}
              error={null}
              vacio="Ningún material coincide."
              fresco
              autoFocus
              enLinea
            />
          </div>
        )}

        {/* Las medidas aparecen con el material elegido, y el largo llega con el foco. */}
        {grupo && conColor && (
          <Campo label="Color de la pieza" requerido ayuda="Este material comparte código entre colores.">
            <Input autoFocus value={color} onChange={(e) => setColor(e.target.value)} maxLength={60} />
          </Campo>
        )}

        {grupo && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Largo (cm)" requerido>
                <Input
                  autoFocus={!conColor}
                  inputMode="decimal"
                  className="tnum"
                  value={largo}
                  onChange={(e) => setLargo(e.target.value)}
                />
              </Campo>
              <Campo label="Ancho (cm)" requerido>
                <Input inputMode="decimal" className="tnum" value={ancho} onChange={(e) => setAncho(e.target.value)} />
              </Campo>
            </div>
            {medidas && (
              <p className="text-muted-foreground -mt-2 text-xs" aria-live="polite">
                {medidaSobrante(medidas)} cm
                {estandar && " · es media o cuarta parte de una plancha: queda como estándar y se usa al final"}
              </p>
            )}

            <Campo label="Ubicación" ayuda="Dónde lo guardas: rack, fila, estante.">
              <Input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} maxLength={80} placeholder="Rack 2, fila B" />
            </Campo>
          </>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Registrando…" : "Registrar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Dónde quedó guardado un sobrante. Se cambia aquí y en la nota de su lote en Odoo. */
export function DialogoUbicacion({ sobrante, alCerrar }: { sobrante: Sobrante | null; alCerrar: () => void }) {
  return (
    <Dialog open={sobrante !== null} onOpenChange={(v) => !v && alCerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mover {sobrante?.codigo}</DialogTitle>
          <DialogDescription>
            {sobrante && `${sobrante.material} · ${medidaSobrante(sobrante)} cm`}
          </DialogDescription>
        </DialogHeader>
        {sobrante && <FormUbicacion sobrante={sobrante} alCerrar={alCerrar} />}
      </DialogContent>
    </Dialog>
  );
}

function FormUbicacion({ sobrante, alCerrar }: { sobrante: Sobrante; alCerrar: () => void }) {
  const [ubicacion, setUbicacion] = useState(sobrante.ubicacion ?? "");
  const [pendiente, iniciar] = useTransition();

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    iniciar(async () => {
      const r = await acciones.cambiarUbicacionSobrante({ codigo: sobrante.codigo, ubicacion });
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success(`${sobrante.codigo} movido`);
      if (r.aviso) toast.warning("Falta Odoo", { description: r.aviso });
      alCerrar();
    });
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <Campo label="Nueva ubicación">
        <Input autoFocus value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} maxLength={80} />
      </Campo>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
