"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import * as acciones from "@/app/(app)/costos-precios/acciones";
import { CONCEPTOS_OPERATIVOS, ETIQUETAS_OPERATIVOS, type ConceptoOperativo } from "@/lib/costeo";
import type { MesDetalle } from "@/lib/costos-servidor";
import { momentoEnLima } from "@/lib/fecha";
import { diaMesTexto, money } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leerNumero } from "@/components/compras/editor-compra";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

interface FilaGasto {
  clave: number;
  concepto: ConceptoOperativo;
  descripcion: string;
  monto: string;
}
let siguiente = 1;

/**
 * Los gastos de operar de cada mes (el 2do costeo). Cada mes: lo gastado por
 * concepto y la base, el costo de lo vendido (calculado con Odoo o escrito a
 * mano). La tasa del mes es gastos ÷ base; la que vale para los precios junta
 * los últimos meses.
 */
export function GastosMes({
  meses,
  tasaVigente,
  mesesPromedio,
  mesActual,
}: {
  meses: MesDetalle[];
  tasaVigente: number | null;
  mesesPromedio: number;
  /** AAAA-MM. */
  mesActual: string;
}) {
  const anterior = (() => {
    const [a, m] = mesActual.split("-").map(Number);
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  })();
  const [mes, setMes] = useState(meses[0]?.mes ?? anterior);
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-card shadow-card flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3">
        <div>
          <p className="text-muted-foreground text-xs">Tasa que vale hoy</p>
          <p className="tnum text-xl font-semibold">{pct(tasaVigente)}</p>
        </div>
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Gastos de operar ÷ costo de lo vendido, de los últimos {mesesPromedio} {mesesPromedio === 1 ? "mes" : "meses"} cerrados con base. El 2do costo = 1er
          costo × (1 + tasa).
        </p>
      </div>

      {meses.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Mes</th>
                <th className="px-3 py-2 text-right font-medium">Gastos de operar</th>
                <th className="px-3 py-2 text-right font-medium">Costo de ventas</th>
                <th className="px-3 py-2 text-right font-medium">Tasa del mes</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes} className={cn("hover:bg-muted/40 cursor-pointer border-t", m.mes === mes && "bg-primary/[0.04]")} onClick={() => setMes(m.mes)}>
                  <td className="px-3 py-2 capitalize">
                    <button type="button" className="hover:text-primary capitalize" onClick={() => setMes(m.mes)}>
                      {nombreMes(m.mes)}
                    </button>
                  </td>
                  <td className="tnum px-3 py-2 text-right">{money(m.gastos)}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {m.base === null ? "—" : money(m.base)}
                    {m.baseManual !== null && <span className="text-muted-foreground text-2xs block">a mano</span>}
                  </td>
                  <td className="tnum px-3 py-2 text-right font-medium">{pct(m.tasa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Campo label="Mes" className="w-44">
          <Input type="month" value={mes} max={mesActual} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </Campo>
        <p className="text-muted-foreground pb-2 text-xs">Elige un mes de la tabla o escribe otro para cargarlo.</p>
      </div>

      <EditorMes key={mes} mes={mes} detalle={meses.find((m) => m.mes === mes) ?? null} />
    </div>
  );
}

function EditorMes({ mes, detalle }: { mes: string; detalle: MesDetalle | null }) {
  const [filas, setFilas] = useState<FilaGasto[]>(() =>
    detalle?.gastosDetalle.length
      ? detalle.gastosDetalle.map((g) => ({ clave: siguiente++, concepto: g.concepto, descripcion: g.descripcion ?? "", monto: String(g.monto) }))
      : CONCEPTOS_OPERATIVOS.filter((c) => c !== "otro").map((c) => ({ clave: siguiente++, concepto: c, descripcion: "", monto: "" })),
  );
  const [manual, setManual] = useState(detalle?.baseManual === null || detalle?.baseManual === undefined ? "" : String(detalle.baseManual));
  const [nota, setNota] = useState(detalle?.nota ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const total = filas.reduce((t, f) => t + (leerNumero(f.monto) ?? 0), 0);
  const cambiar = (clave: number, c: Partial<FilaGasto>) => {
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...c } : f)));
    setError(null);
  };

  const guardar = () => {
    const gastos: { concepto: ConceptoOperativo; descripcion: string; monto: number }[] = [];
    for (const f of filas) {
      if (!f.monto.trim()) continue;
      const m = leerNumero(f.monto);
      if (m === null || m < 0) return setError(`El monto de ${ETIQUETAS_OPERATIVOS[f.concepto].etiqueta} no es válido.`);
      gastos.push({ concepto: f.concepto, descripcion: f.descripcion, monto: m });
    }
    const base = manual.trim() ? leerNumero(manual) : null;
    if (manual.trim() && (base === null || base < 0)) return setError("La base escrita a mano no es válida.");
    iniciar(async () => {
      const r = await acciones.guardarGastosDelMes({ mes, gastos });
      if (!r.ok) return setError(r.error);
      const b = await acciones.guardarBaseManual({ mes, valor: base, nota });
      if (!b.ok) return setError(b.error);
      toast.success(`Gastos de ${nombreMes(mes)} guardados`);
    });
  };

  const calcular = () =>
    iniciar(async () => {
      const r = await acciones.calcularBaseDelMes(mes);
      if (!r.ok) return setError(r.error);
      if (r.aviso) toast.warning("Costo de ventas calculado", { description: r.aviso, duration: 10_000 });
      else toast.success("Costo de ventas calculado con Odoo");
    });

  return (
    <section className="bg-card shadow-card flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-semibold capitalize">{nombreMes(mes)}</h2>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">Gastos de operar</p>
        <ul className="divide-y rounded-xl border" aria-label="Gastos de operar del mes">
          {filas.map((f) => (
            <li key={f.clave} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 sm:grid-cols-[14rem_1fr_9rem_auto] sm:items-end">
              <Campo grupo label="Concepto" className="col-span-2 sm:col-span-1">
                <Select value={f.concepto} onValueChange={(v) => cambiar(f.clave, { concepto: v as ConceptoOperativo })}>
                  <SelectTrigger aria-label="Concepto" className="w-full">
                    <SelectValue>{ETIQUETAS_OPERATIVOS[f.concepto].etiqueta}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONCEPTOS_OPERATIVOS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {ETIQUETAS_OPERATIVOS[c].etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Detalle" className="col-span-2 sm:col-span-1">
                <Input value={f.descripcion} onChange={(e) => cambiar(f.clave, { descripcion: e.target.value })} maxLength={120} placeholder={ETIQUETAS_OPERATIVOS[f.concepto].ayuda} />
              </Campo>
              <Campo label="Monto (S/)">
                <Input inputMode="decimal" value={f.monto} onChange={(e) => cambiar(f.clave, { monto: e.target.value })} className="tnum" />
              </Campo>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground mb-0.5 self-end"
                aria-label={`Quitar ${ETIQUETAS_OPERATIVOS[f.concepto].etiqueta}`}
                onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setFilas((fs) => [...fs, { clave: siguiente++, concepto: "otro", descripcion: "", monto: "" }])}>
            <Plus className="size-3.5" />
            Agregar gasto
          </Button>
          <p className="text-muted-foreground ml-auto text-sm">
            Total <span className="tnum text-foreground font-semibold">{money(total)}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">Costo de lo vendido en el mes (la base)</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="bg-muted/30 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs">Con Odoo: lo que salió a clientes × su 1er costo</p>
              <p className="tnum font-medium">{detalle?.baseOdoo === null || detalle?.baseOdoo === undefined ? "Sin calcular" : money(detalle.baseOdoo)}</p>
              {detalle?.calculadoEn && <p className="text-muted-foreground text-2xs">Calculado el {diaMesTexto(momentoEnLima(detalle.calculadoEn), true)}</p>}
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={calcular} disabled={pendiente}>
              <RefreshCw className="size-3.5" />
              Calcular con Odoo
            </Button>
          </div>
          <Campo label="A mano (S/)" ayuda="Si se escribe, manda sobre Odoo">
            <Input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} className="tnum" />
          </Campo>
        </div>
        <Campo label="Nota">
          <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Por qué se corrigió a mano, qué incluye…" />
        </Campo>
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button onClick={guardar} disabled={pendiente}>
          {pendiente ? "Guardando…" : `Guardar ${nombreMes(mes)}`}
        </Button>
      </div>
    </section>
  );
}
