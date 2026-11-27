"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock, Plus, Receipt, Trash2, Unlock } from "lucide-react";
import * as acciones from "@/app/(app)/compras/acciones";
import { gastoParaCosteo, sePuedenCargarGastos, sePuedeLiquidar, type CompraDetalle, type GastoCompra } from "@/lib/compras";
import {
  CONCEPTOS_GASTO,
  GRUPOS_GASTO,
  REPARTOS,
  TIPOS_MANO_OBRA,
  conceptosDe,
  liquidar,
  montoManoObra,
  type ConceptoGasto,
  type Moneda,
  type Reparto,
  type TipoManoObra,
} from "@/lib/costeo";
import { money, montoEn } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Seccion } from "@/components/ui/seccion";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leerNumero } from "./editor-compra";

interface FilaGasto {
  clave: number;
  concepto: ConceptoGasto;
  descripcion: string;
  moneda: Moneda;
  monto: string;
  reparto: Reparto;
  tipoManoObra: TipoManoObra;
  personas: string;
  horas: string;
  tarifa: string;
  documento: string;
  fechaPago: string;
}

const txt = (n: number | null) => (n === null ? "" : String(n));
let siguiente = 1;

const deGasto = (g: GastoCompra): FilaGasto => ({
  clave: siguiente++,
  concepto: g.concepto,
  descripcion: g.descripcion ?? "",
  moneda: g.moneda,
  monto: txt(g.monto),
  reparto: g.reparto,
  tipoManoObra: g.tipoManoObra ?? "descarga",
  personas: txt(g.personas),
  horas: txt(g.horas),
  tarifa: txt(g.tarifa),
  documento: g.documento ?? "",
  fechaPago: g.fechaPago ?? "",
});

const nuevo = (concepto: ConceptoGasto, tarifas: Record<TipoManoObra, number>): FilaGasto => ({
  clave: siguiente++,
  concepto,
  descripcion: "",
  moneda: CONCEPTOS_GASTO[concepto].moneda,
  monto: "",
  reparto: CONCEPTOS_GASTO[concepto].reparto,
  tipoManoObra: "descarga",
  personas: concepto === "mano_obra" ? "1" : "",
  horas: "",
  tarifa: concepto === "mano_obra" ? txt(tarifas.descarga || null) : "",
  documento: "",
  fechaPago: "",
});

/** La fila como la entiende el cálculo (lo que no se entiende, en cero). */
function aGasto(f: FilaGasto): GastoCompra {
  const mo = f.concepto === "mano_obra";
  const personas = leerNumero(f.personas);
  const horas = leerNumero(f.horas);
  const tarifa = leerNumero(f.tarifa);
  return {
    concepto: f.concepto,
    descripcion: f.descripcion.trim() || null,
    moneda: mo ? "PEN" : f.moneda,
    monto: mo ? montoManoObra(personas ?? 0, horas ?? 0, tarifa ?? 0) : (leerNumero(f.monto) ?? 0),
    reparto: f.reparto,
    tipoManoObra: mo ? f.tipoManoObra : null,
    personas: mo ? personas : null,
    horas: mo ? horas : null,
    tarifa: mo ? tarifa : null,
    fechaPago: f.fechaPago || null,
    documento: f.documento.trim() || null,
  };
}

const DAM: ConceptoGasto[] = ["ad_valorem", "ipm", "igv", "percepcion_igv"];

/**
 * Los gastos de la compra y, debajo, la liquidación en vivo: cuánto cuesta cada
 * plancha puesta en nuestro almacén. Cada gasto se reparte según lo que lo genera
 * (por valor o por kilos) y el IGV, el IPM y la percepción no suben el costo.
 */
export function CostosCompra({ compra, tarifas }: { compra: CompraDetalle; tarifas: Record<TipoManoObra, number> }) {
  const editable = sePuedenCargarGastos(compra.estado);
  const [filas, setFilas] = useState<FilaGasto[]>(() => compra.gastos.map(deGasto));
  const [tcGastos, setTcGastos] = useState(txt(compra.tcGastos));
  const [elegido, setElegido] = useState<ConceptoGasto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sucio, setSucio] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const disponibles = conceptosDe(compra.tipo, compra.incoterm);
  const cambiar = (clave: number, c: Partial<FilaGasto>) => {
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...c } : f)));
    setSucio(true);
    setError(null);
  };
  const agregar = (conceptos: ConceptoGasto[]) => {
    setFilas((fs) => [...fs, ...conceptos.map((c) => nuevo(c, tarifas))]);
    setSucio(true);
  };

  const gastos = filas.map(aGasto);
  const tc = leerNumero(tcGastos);
  const liq = useMemo(
    () =>
      liquidar(
        { tipo: compra.tipo, monedaMercaderia: compra.monedaMercaderia, tcMercaderia: compra.tcMercaderia, tcGastos: tc, incoterm: compra.incoterm },
        compra.lineas.map((l) => ({ cantidad: l.cantidad, kilos: l.kilos, precioUnitario: l.precioUnitario })),
        gastos.map(gastoParaCosteo),
      ),
    [compra, gastos, tc],
  );
  const conceptosConCosto = [...new Set(gastos.filter((g) => g.reparto !== "no_costo" && g.monto > 0).map((g) => g.concepto))];
  // Lo de antes, para comparar: todo (mercadería incluida) entre los kilos.
  const porKiloAntes = liq.kilos > 0 && compra.lineas.every((l) => l.kilos) ? liq.costoTotalPen / liq.kilos : null;

  const guardar = (yLiquidar: boolean) => {
    for (const f of filas) {
      const g = aGasto(f);
      if (f.concepto === "mano_obra" && (g.horas === null || g.personas === null || g.tarifa === null)) {
        return setError("La mano de obra lleva personas, horas y tarifa.");
      }
      if (f.concepto !== "mano_obra" && leerNumero(f.monto) === null) {
        return setError(`Escribe el monto de ${CONCEPTOS_GASTO[f.concepto].etiqueta}.`);
      }
    }
    iniciar(async () => {
      const r = await acciones.guardarGastos({ compraId: compra.id, tcGastos: tc && tc > 0 ? tc : null, gastos });
      if (!r.ok) return setError(r.error);
      setSucio(false);
      if (!yLiquidar) return void toast.success("Gastos guardados");
      const l = await acciones.liquidarCompra(compra.id);
      if (!l.ok) return setError(l.error);
      toast.success(`${compra.codigo} liquidada`, { description: "El costo de cada plancha ya está en Costos y precios." });
    });
  };

  const reabrir = () =>
    iniciar(async () => {
      const r = await acciones.reabrirLiquidacion(compra.id);
      if (!r.ok) return setError(r.error);
      toast.success("Liquidación reabierta", { description: "Corrige los gastos y vuelve a cerrarla." });
    });

  return (
    <>
      <Seccion n={2} titulo="Gastos de la compra" nota={editable ? "Se pueden ir cargando mientras llegan" : "Liquidación cerrada"}>
        <div className="flex flex-wrap items-end gap-3">
          <Campo label="TC gastos (S/ por US$)" className="w-44" ayuda="Para los gastos en dólares">
            <Input
              inputMode="decimal"
              value={tcGastos}
              onChange={(e) => {
                setTcGastos(e.target.value);
                setSucio(true);
              }}
              disabled={!editable}
              className="tnum"
            />
          </Campo>
          {editable && (
            <div className="ml-auto flex flex-wrap items-end gap-2">
              {compra.tipo === "importacion" && (
                <Button variant="outline" className="gap-1.5" onClick={() => agregar(DAM.filter((c) => !filas.some((f) => f.concepto === c)))}>
                  <Receipt className="size-4" />
                  Agregar DAM
                </Button>
              )}
              <Select value={elegido} onValueChange={(v) => setElegido(v as ConceptoGasto)}>
                <SelectTrigger aria-label="Concepto del gasto" className="w-60">
                  <SelectValue>{elegido ? CONCEPTOS_GASTO[elegido].etiqueta : "Elige un gasto"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GRUPOS_GASTO).map(([grupo, titulo]) => {
                    const deGrupo = disponibles.filter((c) => CONCEPTOS_GASTO[c].grupo === grupo);
                    if (deGrupo.length === 0) return null;
                    return (
                      <SelectGroup key={grupo}>
                        <SelectLabel>{titulo}</SelectLabel>
                        {deGrupo.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CONCEPTOS_GASTO[c].etiqueta}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                className="gap-1.5"
                disabled={!elegido}
                onClick={() => {
                  if (elegido) agregar([elegido]);
                  setElegido(null);
                }}
              >
                <Plus className="size-4" />
                Agregar
              </Button>
            </div>
          )}
        </div>

        {filas.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            Sin gastos todavía.{" "}
            {compra.tipo === "importacion"
              ? "Agrega el flete, la DAM, el agente de aduanas, el almacén, el tráiler y la mano de obra a medida que se pagan."
              : "Si recogimos nosotros, agrega el transporte, la mano de obra y el combustible."}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border" aria-label="Gastos">
            {filas.map((f) => {
              const def = CONCEPTOS_GASTO[f.concepto];
              const mo = f.concepto === "mano_obra";
              const g = aGasto(f);
              return (
                <li key={f.clave} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{def.etiqueta}</p>
                    {def.ayuda && <p className="text-muted-foreground text-xs">{def.ayuda}</p>}
                    {f.reparto === "no_costo" && (
                      <span className="text-2xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">Crédito fiscal</span>
                    )}
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground ml-auto"
                        aria-label={`Quitar ${def.etiqueta}`}
                        onClick={() => {
                          setFilas((fs) => fs.filter((x) => x.clave !== f.clave));
                          setSucio(true);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    {mo ? (
                      <>
                        <Campo grupo label="Tipo" className="col-span-2">
                          <Select
                            value={f.tipoManoObra}
                            onValueChange={(v) => {
                              const t = v as TipoManoObra;
                              cambiar(f.clave, { tipoManoObra: t, tarifa: f.tarifa || txt(tarifas[t] || null) });
                            }}
                            disabled={!editable}
                          >
                            <SelectTrigger aria-label="Tipo de mano de obra" className="w-full">
                              <SelectValue>{TIPOS_MANO_OBRA[f.tipoManoObra]}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(TIPOS_MANO_OBRA).map(([v, l]) => (
                                <SelectItem key={v} value={v}>
                                  {l}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Campo>
                        <Campo label="Personas">
                          <Input inputMode="numeric" value={f.personas} onChange={(e) => cambiar(f.clave, { personas: e.target.value })} disabled={!editable} className="tnum" />
                        </Campo>
                        <Campo label="Horas c/u">
                          <Input inputMode="decimal" value={f.horas} onChange={(e) => cambiar(f.clave, { horas: e.target.value })} disabled={!editable} className="tnum" />
                        </Campo>
                        <Campo label="Tarifa S/ por hora">
                          <Input inputMode="decimal" value={f.tarifa} onChange={(e) => cambiar(f.clave, { tarifa: e.target.value })} disabled={!editable} className="tnum" />
                        </Campo>
                        <div className="flex flex-col justify-end pb-2 text-sm">
                          <span className="text-muted-foreground text-xs">Total</span>
                          <span className="tnum font-medium">{money(g.monto)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Campo grupo label="Moneda">
                          <Opciones
                            valores={[f.moneda]}
                            onToggle={(v) => editable && cambiar(f.clave, { moneda: v as Moneda })}
                            opciones={[{ valor: "PEN", label: "S/" }, { valor: "USD", label: "US$" }]}
                          />
                        </Campo>
                        <Campo label="Monto">
                          <Input inputMode="decimal" value={f.monto} onChange={(e) => cambiar(f.clave, { monto: e.target.value })} disabled={!editable} className="tnum" />
                        </Campo>
                        <Campo label="Descripción" className="col-span-2">
                          <Input value={f.descripcion} onChange={(e) => cambiar(f.clave, { descripcion: e.target.value })} disabled={!editable} maxLength={120} />
                        </Campo>
                      </>
                    )}
                    {!mo && (
                      <Campo label="Documento">
                        <Input value={f.documento} onChange={(e) => cambiar(f.clave, { documento: e.target.value })} disabled={!editable} maxLength={60} placeholder="Factura" />
                      </Campo>
                    )}
                    <Campo grupo label="Se reparte" className={mo ? "col-span-2 md:col-span-6" : undefined}>
                      <Select value={f.reparto} onValueChange={(v) => cambiar(f.clave, { reparto: v as Reparto })} disabled={!editable}>
                        <SelectTrigger aria-label="Cómo se reparte" className="w-full">
                          <SelectValue>{REPARTOS[f.reparto]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(REPARTOS).map(([v, l]) => (
                            <SelectItem key={v} value={v}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Campo>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => guardar(false)} disabled={pendiente || !sucio}>
              {pendiente ? "Guardando…" : "Guardar gastos"}
            </Button>
          </div>
        )}
      </Seccion>

      <Seccion
        n={3}
        titulo="Liquidación: costo de adquisición"
        nota={compra.estado === "liquidada" ? "Cerrada" : "Vista previa con los gastos de arriba"}
      >
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Dato titulo="Mercadería" valor={money(liq.mercaderiaPen)} />
          <Dato
            titulo="Gastos que son costo"
            valor={money(liq.gastosPen)}
            nota={liq.mercaderiaPen > 0 ? `${((liq.gastosPen / liq.mercaderiaPen) * 100).toFixed(1)}% de la mercadería` : undefined}
          />
          <Dato titulo="Costo total" valor={money(liq.costoTotalPen)} fuerte />
          <Dato titulo="Crédito fiscal (no es costo)" valor={money(liq.creditoFiscalPen)} nota="IGV, IPM y percepción" />
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Ítem</th>
                <th className="px-3 py-2 text-right font-medium">Cant.</th>
                <th className="px-3 py-2 text-right font-medium">Kilos</th>
                <th className="px-3 py-2 text-right font-medium">Mercadería</th>
                <th className="px-3 py-2 text-right font-medium">Gastos</th>
                <th className="px-3 py-2 text-right font-medium">Costo c/u</th>
                {compra.monedaMercaderia === "USD" && <th className="px-3 py-2 text-right font-medium">US$ c/u</th>}
                <th className="px-3 py-2 text-right font-medium">S/ por kg</th>
                {porKiloAntes !== null && <th className="text-muted-foreground px-3 py-2 text-right font-medium">Antes (todo por kg)</th>}
              </tr>
            </thead>
            <tbody>
              {compra.lineas.map((l, i) => {
                const x = liq.lineas[i];
                const antes = porKiloAntes !== null && l.kilos ? (porKiloAntes * l.kilos) / l.cantidad : null;
                return (
                  <Fragment key={l.posicion}>
                    <tr className="border-t">
                      <td className="px-3 py-2">
                        <span className="text-muted-foreground mr-2 font-mono text-xs">{l.codigo}</span>
                        {l.nombre}
                      </td>
                      <td className="tnum px-3 py-2 text-right">{l.cantidad}</td>
                      <td className="tnum px-3 py-2 text-right">{l.kilos ?? "—"}</td>
                      <td className="tnum px-3 py-2 text-right">{money(x.mercaderiaPen)}</td>
                      <td className="tnum px-3 py-2 text-right">{money(x.gastosPen)}</td>
                      <td className="tnum px-3 py-2 text-right font-semibold">{money(x.costoUnitarioPen)}</td>
                      {compra.monedaMercaderia === "USD" && (
                        <td className="tnum px-3 py-2 text-right">{x.costoUnitarioUsd === null ? "—" : montoEn(x.costoUnitarioUsd, "USD")}</td>
                      )}
                      <td className="tnum px-3 py-2 text-right">{x.costoKgPen === null ? "—" : money(x.costoKgPen)}</td>
                      {porKiloAntes !== null && (
                        <td className="tnum text-muted-foreground px-3 py-2 text-right">{antes === null ? "—" : money(antes)}</td>
                      )}
                    </tr>
                    {conceptosConCosto.length > 0 && (
                      <tr>
                        <td colSpan={9} className="text-muted-foreground px-3 pb-2 text-xs">
                          {conceptosConCosto
                            .map((c) => `${CONCEPTOS_GASTO[c].etiqueta} ${money((x.gastos[c] ?? 0) / l.cantidad)}`)
                            .join(" · ")}{" "}
                          por plancha
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {porKiloAntes !== null && (
          <p className="text-muted-foreground text-xs">
            “Antes” es el cálculo anterior: todo (mercadería incluida) entre los kilos, {money(porKiloAntes)} por kg para todo.
          </p>
        )}

        {liq.errores.length > 0 && (
          <ul className="text-st-en_proceso list-disc pl-5 text-sm">
            {liq.errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {compra.estado === "liquidada" ? (
            <>
              <p className="text-muted-foreground mr-auto text-xs">
                Liquidada{compra.liquidadaPor ? ` por ${compra.liquidadaPor}` : ""}. El costo ya está en Costos y precios.
              </p>
              <Button variant="outline" className="gap-1.5" onClick={reabrir} disabled={pendiente}>
                <Unlock className="size-4" />
                Reabrir liquidación
              </Button>
            </>
          ) : (
            <>
              {!sePuedeLiquidar(compra.estado) && (
                <p className="text-muted-foreground mr-auto text-xs">Se cierra cuando Almacén reciba toda la mercadería.</p>
              )}
              <Button
                className="gap-1.5"
                onClick={() => guardar(true)}
                disabled={pendiente || !sePuedeLiquidar(compra.estado) || liq.errores.length > 0}
              >
                <Lock className="size-4" />
                Cerrar liquidación
              </Button>
            </>
          )}
        </div>
      </Seccion>
    </>
  );
}

function Dato({ titulo, valor, nota, fuerte }: { titulo: string; valor: string; nota?: string; fuerte?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">{titulo}</p>
      <p className={`tnum ${fuerte ? "text-base font-semibold" : "font-medium"}`}>{valor}</p>
      {nota && <p className="text-muted-foreground text-2xs">{nota}</p>}
    </div>
  );
}
