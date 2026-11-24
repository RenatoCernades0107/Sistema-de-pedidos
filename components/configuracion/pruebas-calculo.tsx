"use client";

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, CircleDashed, Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { aprobarPruebaCalculo, ejecutarPruebaCalculo } from "@/app/(app)/configuracion/pruebas-acciones";
import { nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { money } from "@/lib/formato";
import { compararResultados, estadoDe, type Diferencia, type EstadoPrueba } from "@/lib/pruebas-calculo/comparar";
import {
  LLEVA_TEXTO,
  NOMBRES_PRUEBA,
  TIPOS_PRUEBA,
  casoPorDefecto,
  gruposUtiles,
  planchaPorDefecto,
  productosDeTipo,
  type CasoPrueba,
  type Ejecucion,
  type PruebaAprobada,
  type PruebasGuardadas,
  type ResultadoPrueba,
  type TipoPrueba,
} from "@/lib/pruebas-calculo/prueba";
import { textoDeMedidaEstandar, type CatalogoTerminados } from "@/lib/terminados/catalogo";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fecha = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const cuando = (iso: string) => fecha.format(new Date(iso));
const num = (x: number, d = 2) => String(+x.toFixed(d));

const mismoCaso = (a: CasoPrueba, b: CasoPrueba) =>
  a.productoCodigo === b.productoCodigo &&
  a.medidaId === b.medidaId &&
  a.grupoPlanchaId === b.grupoPlanchaId &&
  a.unidades === b.unidades &&
  (!LLEVA_TEXTO[a.tipo] || a.texto.trim() === b.texto.trim());

/**
 * Las pruebas del cálculo de los diseños: un caso por tipo, calculado con lo
 * real (base, motor CAD, Odoo, configuración) y comparado con el resultado que
 * Administración aprobó. Corren solas al abrir la pestaña.
 */
export function PruebasCalculo({
  catalogo,
  grupos,
  guardadas,
}: {
  catalogo: CatalogoTerminados;
  grupos: GrupoPlancha[];
  guardadas: PruebasGuardadas;
}) {
  const [senal, setSenal] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Cada prueba arma un producto real del catálogo con el motor CAD, lo acomoda en planchas y calcula su costo con los
          precios de Odoo y la configuración de hoy, igual que el diseñador de productos terminados. Revisa el desglose y, si
          está bien, apruébalo: desde entonces cada vez que se ejecute se compara con ese resultado y se avisa qué cambió.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setSenal((s) => s + 1)}>
          <Play className="size-3.5" />
          Ejecutar todas
        </Button>
      </div>
      {TIPOS_PRUEBA.map((tipo) => (
        <TarjetaPrueba
          key={tipo}
          tipo={tipo}
          catalogo={catalogo}
          grupos={grupos}
          aprobada={guardadas[tipo] ?? null}
          senal={senal}
        />
      ))}
    </div>
  );
}

const ESTADOS: Record<EstadoPrueba | "error" | "corriendo", { texto: string; clase: string; icono: typeof CircleCheck }> = {
  coincide: { texto: "Coincide con lo aprobado", clase: "text-emerald-700 dark:text-emerald-400", icono: CircleCheck },
  cambio_datos: { texto: "Cambiaron datos", clase: "text-amber-700 dark:text-amber-400", icono: TriangleAlert },
  cambio_calculo: { texto: "Cambió el cálculo", clase: "text-destructive", icono: CircleAlert },
  sin_aprobar: { texto: "Sin resultado aprobado", clase: "text-muted-foreground", icono: CircleDashed },
  error: { texto: "Error", clase: "text-destructive", icono: CircleAlert },
  corriendo: { texto: "Ejecutando…", clase: "text-muted-foreground", icono: CircleDashed },
};

function TarjetaPrueba({
  tipo,
  catalogo,
  grupos,
  aprobada,
  senal,
}: {
  tipo: TipoPrueba;
  catalogo: CatalogoTerminados;
  grupos: GrupoPlancha[];
  aprobada: PruebaAprobada | null;
  senal: number;
}) {
  const productos = useMemo(() => productosDeTipo(catalogo, tipo), [catalogo, tipo]);
  const planchas = useMemo(() => gruposUtiles(grupos), [grupos]);
  const [caso, setCaso] = useState<CasoPrueba | null>(() => aprobada?.caso ?? casoPorDefecto(tipo, catalogo, grupos));
  const [ejecucion, setEjecucion] = useState<Ejecucion | null>(null);
  const [corriendo, iniciar] = useTransition();
  const [confirmar, setConfirmar] = useState(false);

  const ejecutar = () => {
    const c = caso;
    if (!c) return;
    iniciar(async () => {
      try {
        setEjecucion(await ejecutarPruebaCalculo(c));
      } catch {
        setEjecucion({ ok: false, error: "No se pudo ejecutar la prueba. Revisa tu conexión." });
      }
    });
  };

  // Al abrir la pestaña y con «Ejecutar todas», con el caso que haya en pantalla.
  const alPedirlo = useEffectEvent(ejecutar);
  useEffect(() => alPedirlo(), [senal]);

  const aprobar = () => {
    if (!caso) return;
    setConfirmar(false);
    iniciar(async () => {
      try {
        const r = await aprobarPruebaCalculo(caso);
        setEjecucion(r);
        if (r.ok) toast.success(`Prueba de ${NOMBRES_PRUEBA[tipo].toLowerCase()} aprobada.`);
        else toast.error(r.error);
      } catch {
        toast.error("No se pudo aprobar. Revisa tu conexión.");
      }
    });
  };

  const producto = productos.find((p) => p.codigo === caso?.productoCodigo) ?? null;
  const resultado = ejecucion?.ok ? ejecucion.resultado : null;
  const diferencias = useMemo(
    () => (resultado && aprobada ? compararResultados(aprobada.resultado, resultado) : null),
    [resultado, aprobada],
  );
  const estado = corriendo ? "corriendo" : ejecucion && !ejecucion.ok ? "error" : ejecucion ? estadoDe(diferencias) : null;
  const casoDistinto = !!(caso && aprobada && !mismoCaso(caso, aprobada.caso));

  const poner = (cambio: Partial<CasoPrueba>) => setCaso((c) => (c ? { ...c, ...cambio } : c));

  return (
    <section className="bg-card rounded-xl border" data-testid={`prueba-${tipo}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{NOMBRES_PRUEBA[tipo]}</h2>
          {estado && <EstadoChip estado={estado} />}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={ejecutar} disabled={!caso || corriendo}>
            <Play className="size-3.5" />
            Ejecutar
          </Button>
          {confirmar ? (
            <>
              <span className="text-muted-foreground text-xs">¿Reemplazar lo aprobado?</span>
              <Button type="button" size="sm" onClick={aprobar} disabled={corriendo}>
                Sí, aprobar
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmar(false)}>
                No
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => (aprobada ? setConfirmar(true) : aprobar())}
              disabled={!caso || corriendo || !resultado || estado === "coincide"}
              title="Guarda este resultado como el correcto: las próximas ejecuciones se comparan con él."
            >
              <ShieldCheck className="size-3.5" />
              Aprobar resultado
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {!caso || !producto ? (
          <p className="text-muted-foreground text-sm">
            El catálogo no tiene un producto activo con la plantilla «{tipo}» y medidas, o no hay planchas con formatos activos.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Campo label="Producto" className="lg:col-span-2">
              <Select
                value={caso.productoCodigo}
                onValueChange={(v) => {
                  const p = productos.find((x) => x.codigo === v);
                  if (!p) return;
                  const m = [...p.medidas].sort((a, b) => a.orden - b.orden)[0];
                  poner({ productoCodigo: p.codigo, medidaId: m?.id ?? "", grupoPlanchaId: planchaPorDefecto(p, grupos)?.id ?? caso.grupoPlanchaId });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{`${producto.codigo} · ${producto.nombre}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {productos.map((p) => (
                    <SelectItem key={p.codigo} value={p.codigo}>
                      {p.codigo} · {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Medida">
              <Select value={caso.medidaId} onValueChange={(v) => v && poner({ medidaId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(() => {
                      const m = producto.medidas.find((x) => x.id === caso.medidaId);
                      return m ? textoDeMedidaEstandar(m) : "Elige…";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[...producto.medidas]
                    .sort((a, b) => a.orden - b.orden)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {textoDeMedidaEstandar(m)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Plancha" className="lg:col-span-2">
              <Select value={caso.grupoPlanchaId} onValueChange={(v) => v && poner({ grupoPlanchaId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(() => {
                      const g = planchas.find((x) => x.id === caso.grupoPlanchaId);
                      return g ? nombreDeGrupo(g) : "Elige…";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {planchas.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {nombreDeGrupo(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            {LLEVA_TEXTO[tipo] && (
              <Campo label="Texto" className="lg:col-span-2">
                <Input value={caso.texto} maxLength={60} onChange={(e) => poner({ texto: e.target.value })} />
              </Campo>
            )}
            <Campo label="Unidades">
              <Input
                type="number"
                min={1}
                max={500}
                value={caso.unidades}
                onChange={(e) => poner({ unidades: Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))) })}
              />
            </Campo>
          </div>
        )}

        {aprobada && (
          <p className="text-muted-foreground text-xs">
            Aprobado por {aprobada.aprobadoPor} el {cuando(aprobada.aprobadoEn)}: {aprobada.resultado.producto.codigo},{" "}
            {aprobada.resultado.medida}, {aprobada.resultado.plancha}, {aprobada.resultado.unidades} u.
            {casoDistinto && (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}
                El caso de arriba no es el aprobado: la comparación es contra otro caso.
              </span>
            )}
          </p>
        )}

        {ejecucion && !ejecucion.ok && (
          <p className="text-destructive bg-destructive/5 rounded-md px-3 py-2 text-sm">{ejecucion.error}</p>
        )}

        {resultado && (
          <>
            <Resumen resultado={resultado} aprobado={aprobada?.resultado ?? null} />
            {diferencias && diferencias.length > 0 && <TablaDiferencias diferencias={diferencias} />}
            <Desglose resultado={resultado} />
          </>
        )}
      </div>
    </section>
  );
}

function EstadoChip({ estado }: { estado: keyof typeof ESTADOS }) {
  const { texto, clase, icono: Icono } = ESTADOS[estado];
  return (
    <Badge variant="outline" className={cn("gap-1", clase)} data-testid="estado-prueba">
      <Icono className={cn(estado === "corriendo" && "animate-spin")} />
      {texto}
    </Badge>
  );
}

function Resumen({ resultado, aprobado }: { resultado: ResultadoPrueba; aprobado: ResultadoPrueba | null }) {
  const t = resultado.totales;
  const a = aprobado?.totales ?? null;
  const celdas: { etiqueta: string; valor: string; antes: string | null }[] = t
    ? [
        { etiqueta: "Planchas", valor: num(t.planchas, 4), antes: a ? num(a.planchas, 4) : null },
        { etiqueta: "Material", valor: money(t.material), antes: a ? money(a.material) : null },
        { etiqueta: "Láser", valor: `${num(t.minutosLaser)} min · ${money(t.servicio)}`, antes: a ? `${num(a.minutosLaser)} min · ${money(a.servicio)}` : null },
        { etiqueta: "Costo total", valor: money(t.total), antes: a ? money(a.total) : null },
        { etiqueta: "Costo por unidad", valor: money(t.costoUnidad), antes: a ? money(a.costoUnidad) : null },
        {
          etiqueta: `Sugerido/u (× ${num(resultado.producto.factor)})`,
          valor: money(t.sugeridoUnidad),
          antes: a ? money(a.sugeridoUnidad) : null,
        },
      ]
    : [];
  return (
    <div className="flex flex-col gap-2">
      {t ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          {celdas.map((c) => (
            <div key={c.etiqueta}>
              <dt className="text-muted-foreground text-xs">{c.etiqueta}</dt>
              <dd className="tnum text-sm font-medium">{c.valor}</dd>
              {c.antes !== null && c.antes !== c.valor && (
                <dd className="tnum text-muted-foreground text-xs line-through">{c.antes}</dd>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-destructive text-sm">No se pudo calcular el costo.</p>
      )}
      {resultado.problemas.length > 0 && (
        <ul className="text-sm text-amber-700 dark:text-amber-400">
          {resultado.problemas.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TablaDiferencias({ diferencias }: { diferencias: Diferencia[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Qué cambió</th>
            <th className="px-3 py-1.5 text-left font-medium">Tipo</th>
            <th className="px-3 py-1.5 text-right font-medium">Aprobado</th>
            <th className="px-3 py-1.5 text-right font-medium">Ahora</th>
          </tr>
        </thead>
        <tbody>
          {diferencias.map((d) => (
            <tr key={d.ruta} className="border-t">
              <td className="px-3 py-1.5">{d.etiqueta}</td>
              <td className="text-muted-foreground px-3 py-1.5 text-xs">{d.clase === "entrada" ? "Dato" : "Cálculo"}</td>
              <td className="tnum text-muted-foreground px-3 py-1.5 text-right">{d.antes ?? "—"}</td>
              <td className="tnum px-3 py-1.5 text-right font-medium">{d.ahora ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tabla({ cabeza, filas, derecha = [] }: { cabeza: string[]; filas: (string | number)[][]; derecha?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {cabeza.map((c, i) => (
              <th key={c} className={cn("px-2 py-1 font-medium", derecha.includes(i) ? "text-right" : "text-left")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t">
              {f.map((v, j) => (
                <td key={j} className={cn("px-2 py-1", derecha.includes(j) && "tnum text-right")}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Desglose({ resultado: r }: { resultado: ResultadoPrueba }) {
  const e = r.entradas;
  const l = e.laser;
  return (
    <details className="group rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">Desglose del cálculo</summary>
      <div className="mt-3 flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="eyebrow">Caso</h3>
          <p className="text-sm">
            {r.producto.codigo} · {r.producto.nombre} — {r.medida} — {r.plancha} — {r.unidades} u.
            {r.texto ? ` — «${r.texto}»` : ""}
          </p>
          <p className="text-muted-foreground text-xs">Ejecutado el {cuando(r.ejecutadoEn)}</p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="eyebrow">
            Motor CAD: {e.plantilla} v{e.versionPlantilla}
          </h3>
          <Tabla
            cabeza={["Parámetro", "Enviado", "Usado por el motor"]}
            filas={Object.keys({ ...e.parametrosEnviados, ...e.parametros }).map((k) => [
              k,
              e.parametrosEnviados[k] === undefined ? "(por defecto)" : String(e.parametrosEnviados[k]),
              e.parametros[k] === undefined ? "—" : String(e.parametros[k]),
            ])}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="eyebrow">Piezas ({r.piezas.reduce((s, p) => s + p.cantidad, 0)} copias por unidad)</h3>
          <Tabla
            cabeza={["Pieza", "Cant.", "Espesor", "Ancho × alto (mm)", "Área (mm²)", "Perímetro (mm)"]}
            derecha={[1, 2, 3, 4, 5]}
            filas={r.piezas.map((p) => [
              p.nombre,
              p.cantidad,
              `${num(p.espesorMm)} mm`,
              `${num(p.anchoMm, 1)} × ${num(p.altoMm, 1)}`,
              num(p.areaMm2, 0),
              num(p.perimetroMm, 1),
            ])}
          />
          {r.validaciones.length > 0 && (
            <ul className="text-xs">
              {r.validaciones.map((v, i) => (
                <li key={i} className={v.nivel === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
                  {v.nivel === "error" ? "Error" : "Aviso"}: {v.mensaje}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="eyebrow">Acomodo y costo por plancha</h3>
          <Tabla
            cabeza={["Material", "Formato", "Planchas", "Uso", "No entran", "Material S/", "Láser", "Servicio S/", "Total S/"]}
            derecha={[2, 3, 4, 5, 6, 7, 8]}
            filas={r.grupos.map((g) => [
              g.etiqueta,
              g.formato ?? "—",
              `${num(g.planchas, 4)} (${g.planchasAcomodo} física${g.planchasAcomodo === 1 ? "" : "s"})`,
              `${num(g.usoPct)} %`,
              g.noCaben,
              num(g.material),
              `${num(g.minutosLaser)} min`,
              num(g.servicio),
              num(g.total),
            ])}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="eyebrow">Datos usados</h3>
          <Tabla
            cabeza={["Dato", "Valor"]}
            filas={[
              ["Kerf / margen", `${num(e.kerfMm)} mm / ${num(e.margenMm)} mm`],
              [`Láser a ${num(l.espesorMm)} mm`, `${num(l.velocidad)} mm/s · perforación ${num(l.pierce)} s · ${l.pasadas} pasada(s)`],
              ["Rendimiento real / extra por pieza", `× ${num(l.factorVelocidad)} / ${num(l.overheadPorPieza)} s`],
              ["Costo por minuto / IGV", `${money(l.costoPorMinuto)} / ${num(l.igvPct)} %`],
              ["Redondear al sol", e.redondearAlSol ? "Sí" : "No"],
              ["Fracciones de plancha", e.fracciones.join(", ") || "—"],
              ["Factor del tipo", `${r.producto.tipo}: × ${num(r.producto.factor)}`],
              ...e.precios.map((p) => [`Precio Odoo ${p.codigo} (${p.medida})`, p.precio === null ? "Sin precio" : money(p.precio)]),
            ]}
          />
        </section>
      </div>
    </details>
  );
}
