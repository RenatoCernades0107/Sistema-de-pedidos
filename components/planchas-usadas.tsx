"use client";

import { useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { materialDeCorte } from "@/lib/cortes/guardado";
import { MODALIDADES } from "@/lib/cortes/calcular";
import { PLANCHAS_MAXIMAS, hastaDosDecimales, planchasDe, type LineaDePedido } from "@/lib/pedido-lineas";
import { normalizarMedidas, sobrantesDeCorte } from "@/lib/sobrantes";
import type { Resultado } from "@/app/(app)/acciones";
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

export type PlanchasAnotadas = { posicion: number; planchas: number }[];
export type SobrantesGuardados = {
  posicion: number;
  piezas: { largo: number; ancho: number; ubicacion: string | null }[];
}[];

const n = (x: number) => String(+x.toFixed(2));

/** Lo escrito, si es una cantidad de planchas válida. */
function leer(texto: string): number | string {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return "Escribe cuántas planchas se usaron";
  const v = Number(limpio);
  if (!Number.isFinite(v)) return "Escribe un número";
  if (v < 0) return "No pueden ser menos de cero";
  if (v > PLANCHAS_MAXIMAS) return "Son demasiadas planchas";
  if (!hastaDosDecimales(v)) return "Hasta dos decimales";
  return v;
}

/** Una medida en cm, si es válida. */
const medida = (texto: string) => {
  const v = Number(texto.trim().replace(",", "."));
  return texto.trim() && Number.isFinite(v) && v > 0 ? v : null;
};

interface SobranteEnEdicion {
  clave: number;
  largo: string;
  ancho: string;
  ubicacion: string;
}

/**
 * Cuántas planchas se usaron de verdad en cada corte. Es lo que se descuenta del
 * stock en Odoo: llega puesto con lo anotado o, si nadie anotó, con lo
 * calculado, y solo se corrige si se usó otra cantidad.
 *
 * En los cortes con el piloto de sobrantes, al pasar a Listo se confirman
 * además los pedazos que vuelven al almacén: llegan propuestos con lo que dejó
 * el cálculo, y se corrigen con la medida real, se quitan o se agregan.
 *
 * Lo abre el botón "Listo" (`alPasarAListo`), que mueve el pedido y descuenta, y
 * el detalle del pedido, que solo anota las planchas.
 */
export function DialogoPlanchas({
  abierto,
  alCambiar,
  cortes,
  alPasarAListo,
  retazoMin = 30,
  pendiente,
  alConfirmar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  cortes: LineaDePedido[];
  alPasarAListo?: boolean;
  /** El lado mínimo de un sobrante: con menos, es retazo. */
  retazoMin?: number;
  pendiente: boolean;
  alConfirmar: (planchas: PlanchasAnotadas, sobrantes: SobrantesGuardados) => Promise<Resultado>;
}) {
  const conPiloto = alPasarAListo && cortes.some((l) => l.corte?.sobrantes);
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{alPasarAListo ? "Pasar a Listo" : "Planchas usadas"}</DialogTitle>
          <DialogDescription>
            {alPasarAListo
              ? conPiloto
                ? "Confirma las planchas que usaste y los sobrantes que guardaste: con eso se cierra la producción en Odoo."
                : "Al pasar a Listo, estas planchas se descuentan del stock en Odoo. Corrige la cantidad si usaste otra."
              : "Lo que se descontará del stock en Odoo cuando el pedido pase a Listo."}
          </DialogDescription>
        </DialogHeader>
        {/* Se monta al abrir: así cada vez llega con lo último anotado. */}
        {abierto && (
          <Formulario
            cortes={cortes}
            alPasarAListo={alPasarAListo}
            retazoMin={retazoMin}
            pendiente={pendiente}
            alConfirmar={async (planchas, sobrantes) => {
              const r = await alConfirmar(planchas, sobrantes);
              if (r.ok) alCambiar(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

let siguienteClave = 1;

function Formulario({
  cortes,
  alPasarAListo,
  retazoMin,
  pendiente,
  alConfirmar,
}: {
  cortes: LineaDePedido[];
  alPasarAListo?: boolean;
  retazoMin: number;
  pendiente: boolean;
  alConfirmar: (planchas: PlanchasAnotadas, sobrantes: SobrantesGuardados) => Promise<void>;
}) {
  const [valores, setValores] = useState(() => cortes.map((l) => n(planchasDe(l))));
  const [errores, setErrores] = useState<(string | null)[]>(() => cortes.map(() => null));
  const [sobrantes, setSobrantes] = useState<SobranteEnEdicion[][]>(() =>
    cortes.map((l) =>
      alPasarAListo && l.corte?.sobrantes
        ? sobrantesDeCorte(l.corte, retazoMin).map((s) => ({
            clave: siguienteClave++,
            largo: n(s.largo),
            ancho: n(s.ancho),
            ubicacion: "",
          }))
        : [],
    ),
  );
  const [errorSobrantes, setErrorSobrantes] = useState<string | null>(null);

  const cambiarSobrante = (i: number, clave: number, cambios: Partial<SobranteEnEdicion>) => {
    setErrorSobrantes(null);
    setSobrantes((prev) =>
      prev.map((lista, j) => (j === i ? lista.map((s) => (s.clave === clave ? { ...s, ...cambios } : s)) : lista)),
    );
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const leidos = valores.map(leer);
    const nuevos = leidos.map((v) => (typeof v === "string" ? v : null));
    setErrores(nuevos);
    if (nuevos.some(Boolean)) return;

    const guardados: SobrantesGuardados = [];
    for (const [i, l] of cortes.entries()) {
      if (!alPasarAListo || !l.corte?.sobrantes) continue;
      const piezas = [];
      for (const s of sobrantes[i]) {
        const largo = medida(s.largo);
        const ancho = medida(s.ancho);
        if (!largo || !ancho) return setErrorSobrantes("Escribe el largo y el ancho de cada sobrante, o quítalo.");
        const m = normalizarMedidas(largo, ancho);
        if (m.ancho < retazoMin) {
          return setErrorSobrantes(`${n(m.largo)}×${n(m.ancho)} es retazo (un lado de menos de ${retazoMin} cm): quítalo.`);
        }
        piezas.push({ ...m, ubicacion: s.ubicacion.trim() || null });
      }
      guardados.push({ posicion: l.posicion, piezas });
    }
    setErrorSobrantes(null);
    void alConfirmar(
      cortes.map((l, i) => ({ posicion: l.posicion, planchas: leidos[i] as number })),
      guardados,
    );
  };

  return (
    <form onSubmit={enviar} className="flex min-h-0 flex-col gap-4" noValidate>
      <ul className="flex flex-col gap-3 overflow-y-auto">
        {cortes.map((l, i) => {
          const c = l.corte!;
          const piloto = alPasarAListo && c.sobrantes;
          return (
            <li key={l.posicion} className="flex items-start gap-3 rounded-lg border p-3">
              <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {MODALIDADES[c.modalidad]} · {materialDeCorte(c)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Plancha de {n(c.formato.ancho)}×{n(c.formato.alto)}{" "}
                    <span className="font-mono">{c.formato.codigo}</span> · calculadas: {n(l.cantidad)}
                  </p>
                </div>
                <Campo
                  label={`Planchas usadas (${c.formato.codigo})`}
                  error={errores[i] ?? undefined}
                  claseEtiqueta="sr-only"
                >
                  <Input
                    inputMode="decimal"
                    autoFocus={i === 0}
                    className="tnum w-28"
                    value={valores[i]}
                    aria-invalid={!!errores[i]}
                    onChange={(e) => {
                      const v = e.target.value;
                      setValores((prev) => prev.map((x, j) => (j === i ? v : x)));
                      setErrores((prev) => prev.map((x, j) => (j === i ? null : x)));
                    }}
                  />
                </Campo>

                {piloto && (
                  <fieldset className="flex flex-col gap-2 border-t pt-2">
                    <legend className="text-xs font-medium">Sobrantes que vuelven al almacén</legend>
                    {sobrantes[i].length === 0 && (
                      <p className="text-muted-foreground text-xs">Ninguno: todo lo que sobró es retazo.</p>
                    )}
                    {sobrantes[i].map((s, k) => (
                      <div key={s.clave} className="flex flex-wrap items-end gap-2" role="group" aria-label={`Sobrante ${k + 1}`}>
                        <Campo label="Largo" className="w-20">
                          <Input
                            inputMode="decimal"
                            className="tnum"
                            value={s.largo}
                            onChange={(e) => cambiarSobrante(i, s.clave, { largo: e.target.value })}
                          />
                        </Campo>
                        <Campo label="Ancho" className="w-20">
                          <Input
                            inputMode="decimal"
                            className="tnum"
                            value={s.ancho}
                            onChange={(e) => cambiarSobrante(i, s.clave, { ancho: e.target.value })}
                          />
                        </Campo>
                        <Campo label="Ubicación" className="min-w-28 flex-1">
                          <Input
                            value={s.ubicacion}
                            maxLength={80}
                            placeholder="Rack 2"
                            onChange={(e) => cambiarSobrante(i, s.clave, { ubicacion: e.target.value })}
                          />
                        </Campo>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar el sobrante ${k + 1}`}
                          onClick={() =>
                            setSobrantes((prev) => prev.map((lista, j) => (j === i ? lista.filter((x) => x.clave !== s.clave) : lista)))
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start gap-1.5"
                      onClick={() =>
                        setSobrantes((prev) =>
                          prev.map((lista, j) =>
                            j === i ? [...lista, { clave: siguienteClave++, largo: "", ancho: "", ubicacion: "" }] : lista,
                          ),
                        )
                      }
                    >
                      <Plus className="size-3.5" />
                      Agregar sobrante
                    </Button>
                  </fieldset>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {errorSobrantes && (
        <p role="alert" className="text-destructive text-sm">
          {errorSobrantes}
        </p>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : alPasarAListo ? "Pasar a Listo" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
