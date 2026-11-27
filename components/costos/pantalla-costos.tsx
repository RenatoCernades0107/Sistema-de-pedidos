"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Calculator, Search, Tag } from "lucide-react";
import * as acciones from "@/app/(app)/costos-precios/acciones";
import { coincide } from "@/lib/busqueda";
import type { CompraResumen } from "@/lib/compras";
import {
  CONCEPTOS_GASTO,
  REDONDEOS,
  TIPOS_MANO_OBRA,
  factorActual,
  margenActual,
  precioSugerido,
  type ConceptoGasto,
  type ConfigCostos,
  type Redondeo,
  type TipoManoObra,
} from "@/lib/costeo";
import type { CambioPrecio, DatosCostosPrecios, FilaCostoPrecio, PuntoCosto } from "@/lib/costos-servidor";
import { momentoEnLima } from "@/lib/fecha";
import { diaMesTexto, money, montoEn } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { leerNumero } from "@/components/compras/editor-compra";
import { DialogoCostear } from "./dialogo-costear";
import { GastosMes } from "./gastos-mes";
import { GraficoCostos } from "./grafico-costos";

const REDONDEO_TEXTO: Record<Redondeo, string> = { centimo: "al céntimo", decimo: "a S/ 0.10", sol: "al sol" };
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
const fx = (n: number | null) => (n === null ? "—" : `× ${n.toFixed(2)}`);

type Vista = "planchas" | "grafico" | "operar" | "factores";

/**
 * Costos y precios de las planchas, en dos costeos:
 *   1er costo: la compra puesta en el almacén (botón Costear → la orden → sus gastos).
 *   2do costo: el 1ro más los gastos de operar del mes (pestaña Gastos de operar).
 *   Precio:    2do costo × factor, más IGV.
 */
export function PantallaCostos({
  datos,
  compras,
  hoy,
}: {
  datos: DatosCostosPrecios;
  /** Las compras que se pueden costear (recibidas) o revisar (costeadas). */
  compras: CompraResumen[];
  /** AAAA-MM-DD en Lima. */
  hoy: string;
}) {
  const [vista, setVista] = useState<Vista>("planchas");
  const [costeando, setCosteando] = useState(false);
  const porCostear = compras.filter((c) => c.estado !== "liquidada").length;
  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Costos y precios</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            1er costo: la compra puesta en el almacén. 2do costo: más los gastos de operar. Precio: 2do costo × factor.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setCosteando(true)}>
          <Calculator className="size-4" />
          Costear
          {porCostear > 0 && <span className="bg-primary-foreground/20 tnum rounded-full px-1.5 text-xs">{porCostear}</span>}
        </Button>
      </header>
      {datos.errorOdoo && (
        <p className="border-st-en_proceso/30 bg-st-en_proceso-soft/40 mb-4 rounded-xl border px-4 py-3 text-sm">Sin precios de Odoo: {datos.errorOdoo}</p>
      )}
      <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)}>
        <TabsList className="mb-4">
          <TabsTrigger value="planchas">Planchas</TabsTrigger>
          <TabsTrigger value="grafico">Gráfico</TabsTrigger>
          <TabsTrigger value="operar">Gastos de operar</TabsTrigger>
          <TabsTrigger value="factores">Factores y tarifas</TabsTrigger>
        </TabsList>
        <TabsContent value="planchas">
          <TablaCostos datos={datos} />
        </TabsContent>
        <TabsContent value="grafico">
          <GraficoCostos filas={datos.filas} series={datos.series} meses={datos.meses} config={datos.config} hoy={hoy} />
        </TabsContent>
        <TabsContent value="operar">
          <GastosMes meses={datos.meses} tasaVigente={datos.tasaVigente} mesesPromedio={datos.config.mesesPromedio} mesActual={hoy.slice(0, 7)} />
        </TabsContent>
        <TabsContent value="factores">
          <EditorFactores config={datos.config} materiales={datos.materiales} />
        </TabsContent>
      </Tabs>
      {costeando && <DialogoCostear compras={compras} alCerrar={() => setCosteando(false)} />}
    </div>
  );
}

type Filtro = "todas" | "con_costo" | "bajo_factor" | "sin_costo";

function TablaCostos({ datos }: { datos: DatosCostosPrecios }) {
  const { config, filas, tasaVigente } = datos;
  const [consulta, setConsulta] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("con_costo");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Record<string, string>>({});
  const [detalle, setDetalle] = useState<FilaCostoPrecio | null>(null);
  const [factorDe, setFactorDe] = useState<FilaCostoPrecio | null>(null);
  const [pendiente, iniciar] = useTransition();

  const bajo = (f: FilaCostoPrecio) => f.factorActual !== null && f.factorActual < f.factorObjetivo - 0.005;
  const visibles = useMemo(
    () =>
      filas.filter((f) => {
        if (!coincide(`${f.codigo} ${f.material} ${f.titulo}`, consulta)) return false;
        if (filtro === "con_costo") return f.ultimoCosto !== null;
        if (filtro === "sin_costo") return f.ultimoCosto === null;
        if (filtro === "bajo_factor") return bajo(f);
        return true;
      }),
    [filas, consulta, filtro],
  );
  const porMaterial = useMemo(() => {
    const m = new Map<string, FilaCostoPrecio[]>();
    for (const f of visibles) m.set(f.material, [...(m.get(f.material) ?? []), f]);
    return [...m.entries()];
  }, [visibles]);

  /** El precio que se aplicaría: el escrito a mano, o el sugerido. */
  const precioNuevo = (f: FilaCostoPrecio) => {
    const t = manual[f.codigo];
    return t !== undefined ? leerNumero(t) : f.sugerido;
  };
  const aplicables = filas.filter((f) => elegidas.has(f.codigo) && f.productoId && (precioNuevo(f) ?? 0) > 0);

  const alternar = (f: FilaCostoPrecio, si: boolean) =>
    setElegidas((s) => {
      const n = new Set(s);
      if (si) n.add(f.codigo);
      else n.delete(f.codigo);
      return n;
    });

  const aplicar = () =>
    iniciar(async () => {
      const r = await acciones.aplicarPrecios(
        aplicables.map((f) => {
          const precio = precioNuevo(f)!;
          return {
            productoId: f.productoId!,
            codigo: f.codigo,
            nombre: `${f.material} · ${f.titulo}`,
            precioAnterior: f.precio,
            precio,
            costoBase: f.ultimoCosto?.costoUnitarioPen ?? null,
            segundoCosto: f.segundoCosto,
            factor: f.segundoCosto ? factorActual(precio, f.segundoCosto, config) : null,
            margenPct: f.segundoCosto ? margenActual(precio, f.segundoCosto, config) : null,
          };
        }),
      );
      if (!r.ok) return void toast.error(r.error);
      if (r.aviso) toast.warning("Algunos precios no se cambiaron", { description: r.aviso, duration: 12_000 });
      else toast.success(`${aplicables.length} ${aplicables.length === 1 ? "precio actualizado" : "precios actualizados"} en Odoo`);
      setElegidas(new Set());
      setManual({});
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Código, material, color, espesor…" aria-label="Filtrar planchas" className="pl-8" />
        </div>
        <div role="group" aria-label="Mostrar">
          <Opciones
            valores={[filtro]}
            onToggle={(v) => setFiltro(v as Filtro)}
            opciones={[
              { valor: "con_costo", label: "Con costo" },
              { valor: "bajo_factor", label: "Bajo el factor" },
              { valor: "sin_costo", label: "Sin costo" },
              { valor: "todas", label: "Todas" },
            ]}
          />
        </div>
        <p className="text-muted-foreground ml-auto text-xs">
          Gastos de operar: <span className="tnum text-foreground font-medium">{tasaVigente === null ? "sin tasa" : `+${(tasaVigente * 100).toFixed(1)}%`}</span>
        </p>
      </div>

      {visibles.length === 0 ? (
        <div className="text-muted-foreground grid place-items-center rounded-xl border border-dashed px-6 py-12 text-center text-sm">
          <Calculator className="mb-2 size-5 opacity-50" />
          {filtro === "con_costo" && filas.every((f) => !f.ultimoCosto)
            ? "Todavía no hay costos: aparecen cuando se costea una compra (botón Costear)."
            : "Ninguna plancha coincide con el filtro."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
              <tr>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-medium">Plancha</th>
                <th className="px-3 py-2.5 text-right font-medium">1er costo</th>
                <th className="px-3 py-2.5 text-right font-medium">2do costo</th>
                <th className="px-3 py-2.5 text-right font-medium">Precio actual</th>
                <th className="px-3 py-2.5 text-right font-medium">Factor actual</th>
                <th className="px-3 py-2.5 text-right font-medium">Factor</th>
                <th className="px-3 py-2.5 text-right font-medium">Precio nuevo</th>
              </tr>
            </thead>
            <tbody>
              {porMaterial.map(([material, lista]) => (
                <Fragment key={material}>
                  <tr className="bg-muted/20 border-t">
                    <th colSpan={8} className="px-3 py-1.5 text-left text-xs font-semibold">
                      {material}
                      <span className="text-muted-foreground ml-2 font-normal">factor {fx(config.factorPorMaterial[material] ?? config.factorDefecto)}</span>
                    </th>
                  </tr>
                  {lista.map((f) => {
                    const nuevo = precioNuevo(f);
                    const puede = !!f.productoId && !!f.ultimoCosto;
                    return (
                      <tr key={f.codigo} className="border-t">
                        <td className="px-3 py-2">
                          {puede && <Checkbox checked={elegidas.has(f.codigo)} onCheckedChange={(v) => alternar(f, v === true)} aria-label={`Elegir ${f.codigo}`} />}
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" className="hover:text-primary text-left" onClick={() => f.productoId && setDetalle(f)} disabled={!f.productoId}>
                            <span className="text-muted-foreground mr-2 font-mono text-xs">{f.codigo}</span>
                            {f.titulo}
                          </button>
                        </td>
                        <td className="tnum px-3 py-2 text-right">
                          {f.ultimoCosto ? (
                            <>
                              <span>{money(f.ultimoCosto.costoUnitarioPen)}</span>
                              <span className="text-muted-foreground text-2xs block">
                                {f.ultimoCosto.referencia ?? ""} · {diaMesTexto(f.ultimoCosto.fecha)}
                                {f.ultimoCosto.origen === "ingreso" && " · sin gastos"}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-medium">{f.segundoCosto === null ? "—" : money(f.segundoCosto)}</td>
                        <td className="tnum px-3 py-2 text-right">{f.precio === null ? "—" : money(f.precio)}</td>
                        <td className={cn("tnum px-3 py-2 text-right", bajo(f) && "text-st-anulado font-medium")}>
                          {fx(f.factorActual)}
                          {f.margenActual !== null && <span className="text-muted-foreground text-2xs block">margen {pct(f.margenActual)}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setFactorDe(f)}
                            className={cn("tnum hover:text-primary rounded px-1", f.origenFactor === "plancha" && "bg-primary/10 text-primary font-medium")}
                            title={f.origenFactor === "plancha" ? "Factor propio de esta plancha" : `Factor de ${f.origenFactor === "material" ? "su material" : "general"}`}
                          >
                            {fx(f.factorObjetivo)}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {puede ? (
                            <Input
                              inputMode="decimal"
                              aria-label={`Precio nuevo de ${f.codigo}`}
                              value={manual[f.codigo] ?? (f.sugerido === null ? "" : String(f.sugerido))}
                              onChange={(e) => {
                                setManual((m) => ({ ...m, [f.codigo]: e.target.value }));
                                alternar(f, true);
                              }}
                              className={cn("tnum ml-auto h-7 w-24 text-right", nuevo !== null && f.precio !== null && Math.abs(nuevo - f.precio) >= 0.01 && "border-primary/50")}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted-foreground mt-3 text-xs">
        Precio sugerido = 2do costo × factor{config.preciosIncluyenIgv ? ` + ${config.igvPct}% de IGV` : ""}, redondeado {REDONDEO_TEXTO[config.redondeo]} hacia arriba. El factor
        actual sale del precio de hoy sin IGV ÷ 2do costo.
      </p>

      {elegidas.size > 0 && (
        <div className="bg-card shadow-raised sticky bottom-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">
            {aplicables.length} {aplicables.length === 1 ? "precio elegido" : "precios elegidos"} para poner en Odoo
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setElegidas(new Set());
              setManual({});
            }}
            disabled={pendiente}
          >
            Limpiar
          </Button>
          <Button className="gap-1.5" onClick={aplicar} disabled={pendiente || aplicables.length === 0}>
            <Tag className="size-4" />
            {pendiente ? "Aplicando…" : "Aplicar en Odoo"}
          </Button>
        </div>
      )}

      {detalle && <PanelHistorial fila={detalle} alCerrar={() => setDetalle(null)} />}
      {factorDe && <PanelFactor fila={factorDe} config={config} alCerrar={() => setFactorDe(null)} />}
    </>
  );
}

/** El historial de una plancha: cada costo liquidado, con su desglose, y cada cambio de precio. */
function PanelHistorial({ fila, alCerrar }: { fila: FilaCostoPrecio; alCerrar: () => void }) {
  const [datos, setDatos] = useState<{ costos: PuntoCosto[]; precios: CambioPrecio[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    void acciones.historialDePlancha(fila.productoId).then((r) => {
      if (!vigente) return;
      if (r.ok) setDatos(r.historial);
      else setError(r.error);
    });
    return () => {
      vigente = false;
    };
  }, [fila.productoId]);
  return (
    <Sheet open onOpenChange={(a) => !a && alCerrar()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>
            <span className="text-muted-foreground mr-2 font-mono text-sm">{fila.codigo}</span>
            {fila.material}
          </SheetTitle>
          <SheetDescription>{fila.titulo}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-5 py-4">
          {error && <p className="text-destructive text-sm">{error}</p>}
          {!datos && !error && <p className="text-muted-foreground text-sm">Cargando…</p>}
          {datos && (
            <>
              <section>
                <h3 className="mb-2 text-sm font-semibold">1er costo en cada compra</h3>
                {datos.costos.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Sin compras costeadas todavía.</p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {datos.costos.map((c, i) => {
                      const anterior = datos.costos[i + 1];
                      const cambio = anterior ? ((c.costoUnitarioPen - anterior.costoUnitarioPen) / anterior.costoUnitarioPen) * 100 : null;
                      const gastos = Object.entries(c.desglose.gastos ?? {}).filter(([, v]) => v > 0);
                      return (
                        <li key={`${c.referencia}-${i}`} className="flex flex-col gap-1 px-3 py-2.5">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="tnum font-semibold">{money(c.costoUnitarioPen)}</span>
                            {c.costoUnitarioUsd !== null && <span className="tnum text-muted-foreground text-xs">{montoEn(c.costoUnitarioUsd, "USD")}</span>}
                            {cambio !== null && Math.abs(cambio) >= 0.05 && (
                              <span className="tnum text-muted-foreground text-xs">
                                {cambio > 0 ? "▲ +" : "▼ "}
                                {cambio.toFixed(1)}%
                              </span>
                            )}
                            <span className="text-muted-foreground ml-auto text-xs">
                              {c.referencia ? (
                                c.origen === "liquidacion" ? (
                                  <a href={`/costos-precios/costear/${c.referencia}`} className="text-primary hover:underline">
                                    {c.referencia}
                                  </a>
                                ) : (
                                  c.referencia
                                )
                              ) : null}{" "}
                              · {diaMesTexto(c.fecha, true)} · {c.cantidad} u.
                            </span>
                          </div>
                          {c.desglose.mercaderia !== undefined && (
                            <p className="text-muted-foreground text-xs">
                              Mercadería {money(c.desglose.mercaderia)}
                              {gastos.map(([k, v]) => ` · ${CONCEPTOS_GASTO[k as ConceptoGasto]?.etiqueta ?? k} ${money(v)}`).join("")}
                              {c.costoKgPen !== null && ` · ${money(c.costoKgPen)}/kg`}
                            </p>
                          )}
                          {c.origen === "ingreso" && <p className="text-muted-foreground text-xs">Ingreso de antes de las compras: solo el costo escrito, sin gastos.</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Cambios de precio</h3>
                {datos.precios.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Ninguno desde esta pantalla.</p>
                ) : (
                  <ul className="divide-y rounded-xl border text-sm">
                    {datos.precios.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                        <span className="tnum">
                          {p.precioAnterior === null ? "—" : money(p.precioAnterior)} → <span className="font-semibold">{money(p.precioNuevo)}</span>
                        </span>
                        {p.factor !== null && <span className="text-muted-foreground text-xs">factor {fx(p.factor)}</span>}
                        {p.segundoCosto !== null && <span className="text-muted-foreground text-xs">2do costo {money(p.segundoCosto)}</span>}
                        <span className="text-muted-foreground ml-auto text-xs">
                          {diaMesTexto(momentoEnLima(p.fecha), true)}
                          {p.quien && ` · ${p.quien}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** El factor propio de una plancha, o volver al de su material. */
function PanelFactor({ fila, config, alCerrar }: { fila: FilaCostoPrecio; config: ConfigCostos; alCerrar: () => void }) {
  const [valor, setValor] = useState(fila.factorPlancha === null ? "" : String(fila.factorPlancha));
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const delMaterial = config.factorPorMaterial[fila.material] ?? config.factorDefecto;
  const f = leerNumero(valor);
  const vista = fila.segundoCosto ? precioSugerido(fila.segundoCosto, f ?? delMaterial, config) : null;

  const guardar = (factor: number | null) =>
    iniciar(async () => {
      const r = await acciones.guardarFactorPlancha({ codigo: fila.codigo, factor });
      if (!r.ok) return setError(r.error);
      toast.success(factor === null ? "Vuelve al factor de su material" : "Factor guardado");
      alCerrar();
    });

  return (
    <Sheet open onOpenChange={(a) => !a && alCerrar()}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Factor de {fila.codigo}</SheetTitle>
          <SheetDescription>
            {fila.material} · {fila.titulo}. Sin factor propio usa el de su material ({fx(delMaterial)}).
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4">
          <Campo label="Factor propio" error={error ?? undefined}>
            <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={String(delMaterial)} className="tnum" />
          </Campo>
          {vista !== null && (
            <p className="text-muted-foreground text-sm">
              Precio sugerido con ese factor: <span className="tnum text-foreground font-medium">{money(vista)}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (f === null ? setError("Escribe el factor.") : guardar(f))} disabled={pendiente}>
              Guardar
            </Button>
            {fila.factorPlancha !== null && (
              <Button variant="outline" onClick={() => guardar(null)} disabled={pendiente}>
                Usar el del material
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** El factor general y por material, los meses de la tasa, el IGV, el redondeo y las tarifas de mano de obra. */
function EditorFactores({ config, materiales }: { config: ConfigCostos; materiales: string[] }) {
  const t = (n: number | undefined) => (n === undefined ? "" : String(n));
  const [general, setGeneral] = useState(t(config.factorDefecto));
  const [porMaterial, setPorMaterial] = useState<Record<string, string>>(Object.fromEntries(materiales.map((m) => [m, t(config.factorPorMaterial[m])])));
  const [meses, setMeses] = useState(t(config.mesesPromedio));
  const [igv, setIgv] = useState(t(config.igvPct));
  const [incluye, setIncluye] = useState(config.preciosIncluyenIgv);
  const [redondeo, setRedondeo] = useState<Redondeo>(config.redondeo);
  const [tarifas, setTarifas] = useState<Record<TipoManoObra, string>>({
    descarga: t(config.tarifasManoObra.descarga),
    supervision: t(config.tarifasManoObra.supervision),
    despacho: t(config.tarifasManoObra.despacho),
  });
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const guardar = () => {
    const factorPorMaterial: Record<string, number> = {};
    for (const [m, v] of Object.entries(porMaterial)) {
      if (!v.trim()) continue;
      const n = leerNumero(v);
      if (n === null) return setError(`El factor de ${m} no es un número.`);
      factorPorMaterial[m] = n;
    }
    iniciar(async () => {
      const r = await acciones.guardarConfigCostos({
        factorDefecto: leerNumero(general),
        factorPorMaterial,
        mesesPromedio: leerNumero(meses),
        igvPct: leerNumero(igv),
        preciosIncluyenIgv: incluye,
        redondeo,
        tarifasManoObra: {
          descarga: leerNumero(tarifas.descarga) ?? 0,
          supervision: leerNumero(tarifas.supervision) ?? 0,
          despacho: leerNumero(tarifas.despacho) ?? 0,
        },
      });
      if (!r.ok) return setError(r.error);
      setError(null);
      toast.success("Factores y tarifas guardados");
    });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <section className="bg-card shadow-card flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Factor (margen de ganancia)</h2>
        <p className="text-muted-foreground -mt-2 text-xs">
          Precio sin IGV = 2do costo × factor. Un factor de 1.40 deja 28.6% de margen sobre el precio. Una plancha puede tener el suyo (se fija desde la tabla, tocando su factor).
        </p>
        <Campo label="General" className="w-40" ayuda="Para los materiales sin factor propio">
          <Input inputMode="decimal" value={general} onChange={(e) => setGeneral(e.target.value)} className="tnum" />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          {materiales.map((m) => (
            <Campo key={m} label={m}>
              <Input inputMode="decimal" value={porMaterial[m] ?? ""} onChange={(e) => setPorMaterial((p) => ({ ...p, [m]: e.target.value }))} placeholder={`General (${general || "—"})`} className="tnum" />
            </Campo>
          ))}
        </div>
      </section>

      <section className="bg-card shadow-card flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Gastos de operar y precio de lista</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Meses para la tasa" ayuda="Se juntan los últimos meses">
            <Input inputMode="numeric" value={meses} onChange={(e) => setMeses(e.target.value)} className="tnum" />
          </Campo>
          <Campo label="IGV (%)">
            <Input inputMode="decimal" value={igv} onChange={(e) => setIgv(e.target.value)} className="tnum" />
          </Campo>
          <Campo grupo label="Los precios de Odoo">
            <Opciones valores={[incluye ? "si" : "no"]} onToggle={(v) => setIncluye(v === "si")} opciones={[{ valor: "si", label: "Incluyen IGV" }, { valor: "no", label: "Sin IGV" }]} />
          </Campo>
          <Campo grupo label="Redondeo">
            <Opciones valores={[redondeo]} onToggle={(v) => setRedondeo(v as Redondeo)} opciones={Object.entries(REDONDEOS).map(([valor, label]) => ({ valor, label }))} />
          </Campo>
        </div>
      </section>

      <section className="bg-card shadow-card flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Tarifa de la mano de obra (S/ por hora)</h2>
        <p className="text-muted-foreground -mt-2 text-xs">Se propone al cargar la mano de obra al costear una compra (personas × horas × tarifa).</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(TIPOS_MANO_OBRA) as TipoManoObra[]).map((k) => (
            <Campo key={k} label={TIPOS_MANO_OBRA[k]}>
              <Input inputMode="decimal" value={tarifas[k]} onChange={(e) => setTarifas((x) => ({ ...x, [k]: e.target.value }))} className="tnum" />
            </Campo>
          ))}
        </div>
      </section>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button onClick={guardar} disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
