"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, CircleAlert, Loader2, Plus, Trash2, X } from "lucide-react";
import type { RespuestaPrecios } from "@/app/api/cortes/precios/route";
import type { RespuestaStock } from "@/app/api/cortes/stock/route";
import {
  MODALIDADES,
  compararFormatos,
  type CalculoCorte,
  type Modalidad,
  type PiezaPedida,
} from "@/lib/cortes/calcular";
import {
  buscarGrupos,
  colorDe,
  espesorTexto,
  medidaDe,
  nombreDeGrupo,
  pideColor,
  type GrupoPlancha,
} from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { money } from "@/lib/formato";
import type { LineaCorte } from "@/lib/lineas-cotizacion";
import { cn } from "@/lib/utils";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LeyendaPlano, PlanoCorte } from "./plano-corte";

/** Cuántos formatos se proponen. Son los que se le preguntan a Odoo, de una vez. */
const CANDIDATOS = 3;

type CorteNuevo = Omit<LineaCorte, "tipo" | "clave"> & { clave?: string };

interface FilaPieza {
  ancho: string;
  alto: string;
  cantidad: string;
}

const FILA_VACIA: FilaPieza = { ancho: "", alto: "", cantidad: "" };

const aNumero = (t: string) => {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Las filas que ya son una pieza: con sus tres números. */
function piezasDe(filas: FilaPieza[]): PiezaPedida[] {
  return filas
    .map((f) => ({ ancho: aNumero(f.ancho), alto: aNumero(f.alto), cantidad: Math.floor(aNumero(f.cantidad)) }))
    .filter((p) => p.ancho > 0 && p.alto > 0 && p.cantidad > 0);
}

/* ── Precios y stock ───────────────────────────────────────────────────────── */

type Precios = RespuestaPrecios["precios"];

/** Los precios de un material no cambian mientras se arma un corte: se piden una vez. */
const preciosVistos = new Map<string, Precios>();

function usePrecios(grupoId: string | null) {
  const [estado, setEstado] = useState<{ grupoId: string; precios: Precios | null; error: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!grupoId) return;
    const visto = preciosVistos.get(grupoId);
    if (visto) return;

    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/cortes/precios?grupo=${grupoId}`, { signal: ctrl.signal });
        const json = (await res.json()) as RespuestaPrecios & { error?: string };
        if (!res.ok) {
          setEstado({ grupoId, precios: null, error: json.error ?? "No se pudieron leer los precios." });
          return;
        }
        preciosVistos.set(grupoId, json.precios);
        setEstado({ grupoId, precios: json.precios, error: null });
      } catch {
        if (!ctrl.signal.aborted) {
          setEstado({ grupoId, precios: null, error: "No se pudieron leer los precios. Revisa la conexión." });
        }
      }
    })();
    return () => ctrl.abort();
  }, [grupoId]);

  if (!grupoId) return { precios: null, error: null };
  const visto = preciosVistos.get(grupoId);
  if (visto) return { precios: visto, error: null };
  return estado?.grupoId === grupoId ? { precios: estado.precios, error: estado.error } : { precios: null, error: null };
}

type Stock = Record<string, number | null>;

/**
 * El stock de los formatos candidatos, en una sola consulta a Odoo. Espera a que
 * se deje de escribir: mientras cambian las piezas cambian los candidatos, y no
 * tiene sentido preguntar por cada tecla.
 */
function useStock(codigos: string[]) {
  const clave = [...codigos].sort().join(",");
  const [estado, setEstado] = useState<{ clave: string; stock: Stock | null; error: boolean } | null>(null);

  useEffect(() => {
    if (!clave) return;
    const ctrl = new AbortController();
    const temporizador = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cortes/stock?codigos=${encodeURIComponent(clave)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as RespuestaStock;
        setEstado({ clave, stock: json.stock, error: false });
      } catch {
        if (!ctrl.signal.aborted) setEstado({ clave, stock: null, error: true });
      }
    }, 350);
    return () => {
      clearTimeout(temporizador);
      ctrl.abort();
    };
  }, [clave]);

  const alDia = estado?.clave === clave;
  return {
    /** `null` mientras Odoo no contesta por estos candidatos. */
    stock: alDia ? estado.stock : null,
    validando: !!clave && !alDia,
    fallo: alDia && estado.error,
  };
}

/* ── El editor ─────────────────────────────────────────────────────────────── */

/**
 * Arma un corte a medida: de qué material, cómo se corta y qué piezas.
 *
 * El cálculo corre aquí mismo, a cada tecla, sobre todos los formatos de plancha
 * de ese material. De ahí salen los tres más convenientes, y solo por esos se le
 * pregunta a Odoo si hay stock —una vez, por los tres—. Queda elegido el más
 * barato que tenga planchas suficientes.
 */
export function EditorCorte({
  catalogo,
  config,
  inicial,
  alGuardar,
  alCerrar,
}: {
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  /** El corte que se está editando; `null` para uno nuevo. */
  inicial: LineaCorte | null;
  alGuardar: (corte: CorteNuevo) => void;
  alCerrar: () => void;
}) {
  const [grupoId, setGrupoId] = useState<string | null>(inicial?.grupoId ?? null);
  const [consulta, setConsulta] = useState("");
  const [color, setColor] = useState(inicial?.color ?? "");
  const [modalidad, setModalidad] = useState<Modalidad>(inicial?.modalidad ?? "laser");
  const [filas, setFilas] = useState<FilaPieza[]>(() =>
    inicial
      ? inicial.piezas.map((p) => ({ ancho: String(p.ancho), alto: String(p.alto), cantidad: String(p.cantidad) }))
      : [FILA_VACIA],
  );
  /** El formato que eligió la persona. Mientras sea `null`, manda la sugerencia. */
  const [aMano, setAMano] = useState<string | null>(inicial?.calculo.formato.codigo ?? null);

  const anchos = useRef(new Map<number, HTMLInputElement>());
  /**
   * La fila que tiene que recibir el foco en cuanto exista. No se puede enfocar
   * en el momento: la fila todavía no está pintada cuando se pide.
   */
  const porEnfocar = useRef<number | null>(null);
  const buscador = useRef<HTMLInputElement>(null);

  const grupo = catalogo.find((g) => g.id === grupoId) ?? null;
  const conColor = grupo ? pideColor(grupo) : false;
  const { precios, error: errorPrecios } = usePrecios(grupoId);
  const piezas = useMemo(() => piezasDe(filas), [filas]);

  const calculos = useMemo(() => {
    if (!grupo || !precios || piezas.length === 0) return [];
    const formatos = grupo.formatos
      .filter((f) => precios[f.codigo])
      .map((f) => ({ codigo: f.codigo, ancho: f.anchoCm, alto: f.largoCm, precio: precios[f.codigo].precio }));
    return compararFormatos({ piezas, espesorMm: grupo.espesorMm, modalidad, rotable: grupo.rotable }, formatos, config);
  }, [grupo, precios, piezas, modalidad, config]);

  const candidatos = calculos.slice(0, CANDIDATOS);
  // El formato elegido a mano también se valida, aunque ya no esté entre los tres.
  const elegidoAMano = aMano ? (calculos.find((c) => c.formato.codigo === aMano) ?? null) : null;
  const aValidar = [...new Set([...candidatos, ...(elegidoAMano ? [elegidoAMano] : [])].map((c) => c.formato.codigo))];
  const { stock, validando, fallo: falloStock } = useStock(aValidar);

  const alcanza = (c: CalculoCorte) => {
    const hay = stock?.[c.formato.codigo];
    return typeof hay === "number" && hay >= c.planchas.length;
  };
  // Sin respuesta de Odoo no se sugiere nada: la sugerencia es "el mejor con stock".
  const sugerido = stock ? (candidatos.find((c) => !c.problema && alcanza(c)) ?? null) : null;
  const elegido = elegidoAMano ?? sugerido;
  const mostrados = elegidoAMano && !candidatos.includes(elegidoAMano) ? [...candidatos, elegidoAMano] : candidatos;

  const sinOdoo = grupo && precios ? grupo.formatos.filter((f) => !precios[f.codigo]) : [];
  const faltaColor = conColor && !color.trim();
  const listo = !!grupo && !!elegido && !elegido.problema && !faltaColor;

  const elegirGrupo = (g: GrupoPlancha) => {
    setGrupoId(g.id);
    setConsulta("");
    setAMano(null);
    setColor(pideColor(g) ? g.detalle : "");
    // Con el material elegido, lo siguiente son las medidas.
    porEnfocar.current = 0;
  };

  const cambiarFila = (i: number, cambios: Partial<FilaPieza>) => {
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
    setAMano(null);
  };

  const agregarFila = () => {
    porEnfocar.current = filas.length;
    setFilas((fs) => [...fs, FILA_VACIA]);
  };

  /** Enter en la cantidad: otra medida. Así se dictan las piezas sin soltar el teclado. */
  const enterEnCantidad = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const f = filas[i];
    if (i === filas.length - 1 && f.ancho && f.alto && f.cantidad) agregarFila();
    else anchos.current.get(i + 1)?.focus();
  };

  const guardar = () => {
    if (!grupo || !elegido || !listo) return;
    alGuardar({
      clave: inicial?.clave,
      grupoId: grupo.id,
      material: grupo.material,
      color: conColor ? color.trim() : colorDe(grupo),
      espesorMm: grupo.espesorMm,
      rotable: grupo.rotable,
      modalidad,
      piezas,
      calculo: elegido,
    });
  };

  const opciones: Opcion[] = useMemo(
    () =>
      buscarGrupos(catalogo, consulta).map((g) => ({
        valor: g.id,
        alElegir: () => elegirGrupo(g),
        contenido: (
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{g.material}</span>
            <span>{colorDe(g)}</span>
            <span className="tnum">{espesorTexto(g.espesorMm)}</span>
            <span className="text-muted-foreground ml-auto text-xs">
              {g.formatos.map(medidaDe).join(" · ")}
            </span>
          </span>
        ),
      })),
    [catalogo, consulta],
  );

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent
        className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            // Que no llegue al formulario de debajo: aquí Ctrl+Enter agrega el corte.
            e.preventDefault();
            e.stopPropagation();
            guardar();
          }
        }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{inicial ? "Editar corte" : "Corte a medida"}</DialogTitle>
          <DialogDescription>
            Elige el material y escribe las piezas. La plancha, el precio y el stock los resuelve el sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
          {/* 1. Material */}
          {grupo ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">Material</p>
                <p className="bg-muted/50 mt-1.5 flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm" data-testid="material-elegido">
                  <span className="min-w-0 flex-1 font-medium">{nombreDeGrupo(grupo)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      // El buscador aparece con `autoFocus`.
                      setGrupoId(null);
                      setAMano(null);
                    }}
                  >
                    Cambiar
                  </Button>
                </p>
              </div>
              {conColor && (
                <Campo
                  label="Color"
                  requerido
                  className="w-40"
                  error={faltaColor ? "Escribe el color" : undefined}
                >
                  <Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={60} />
                </Campo>
              )}
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
                vacio="Ningún material coincide. Los materiales se administran en Configuración."
                fresco
                inputRef={buscador}
                autoFocus
                enLinea
              />
            </div>
          )}

          {grupo && (
            <>
              {/* 2. Cómo se corta */}
              <Campo grupo label="Tipo de corte">
                <Opciones
                  valores={[modalidad]}
                  onToggle={(v) => {
                    setModalidad(v as Modalidad);
                    setAMano(null);
                  }}
                  opciones={Object.entries(MODALIDADES).map(([valor, label]) => ({ valor, label }))}
                />
              </Campo>

              {/* 3. Piezas */}
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">
                  Piezas <span className="text-muted-foreground font-normal">(medidas en centímetros)</span>
                </p>
                <ol className="flex flex-col gap-1.5">
                  {filas.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span
                        className="bg-primary/15 text-foreground tnum grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold"
                        title="El número con que esta medida aparece en el plano"
                      >
                        {i + 1}
                      </span>
                      <Input
                        ref={(el) => {
                          if (!el) {
                            anchos.current.delete(i);
                            return;
                          }
                          anchos.current.set(i, el);
                          if (porEnfocar.current === i) {
                            porEnfocar.current = null;
                            el.focus();
                          }
                        }}
                        inputMode="decimal"
                        placeholder="Ancho"
                        aria-label={`Ancho de la pieza ${i + 1}`}
                        value={f.ancho}
                        onChange={(e) => cambiarFila(i, { ancho: e.target.value })}
                        className="tnum w-24"
                      />
                      <span className="text-muted-foreground text-sm" aria-hidden>
                        ×
                      </span>
                      <Input
                        inputMode="decimal"
                        placeholder="Alto"
                        aria-label={`Alto de la pieza ${i + 1}`}
                        value={f.alto}
                        onChange={(e) => cambiarFila(i, { alto: e.target.value })}
                        className="tnum w-24"
                      />
                      <span className="text-muted-foreground px-1 text-xs">cm,</span>
                      <Input
                        inputMode="numeric"
                        placeholder="Cant."
                        aria-label={`Cantidad de la pieza ${i + 1}`}
                        value={f.cantidad}
                        onChange={(e) => cambiarFila(i, { cantidad: e.target.value })}
                        onKeyDown={(e) => enterEnCantidad(e, i)}
                        className="tnum w-20"
                      />
                      <span className="text-muted-foreground text-xs">pzas</span>
                      {filas.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground ml-auto"
                          aria-label={`Quitar la pieza ${i + 1}`}
                          onClick={() => {
                            setFilas((fs) => fs.filter((_, j) => j !== i));
                            setAMano(null);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
                <div>
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2 gap-1" onClick={agregarFila}>
                    <Plus />
                    Otra medida
                  </Button>
                </div>
              </div>

              {/* 4. Formatos */}
              {errorPrecios && (
                <p role="alert" className="text-destructive text-sm">
                  {errorPrecios}
                </p>
              )}
              {!precios && !errorPrecios && (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Leyendo los precios de las planchas…
                </p>
              )}
              {precios && piezas.length === 0 && (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center text-sm">
                  Escribe el ancho, el alto y la cantidad de cada pieza para ver qué plancha conviene.
                </p>
              )}
              {precios && piezas.length > 0 && calculos.length === 0 && (
                <p role="alert" className="text-destructive text-sm">
                  Ninguna plancha de este material existe en Odoo con su código. Revisa el catálogo en Configuración.
                </p>
              )}

              {mostrados.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <p className="text-xs font-medium">Plancha</p>
                    <p className="text-muted-foreground text-xs" aria-live="polite">
                      {validando
                        ? "Validando el stock en Odoo…"
                        : falloStock
                          ? "No se pudo validar el stock en Odoo. Puedes elegir igual."
                          : sugerido && !elegidoAMano
                            ? "Elegida la más barata con stock."
                            : !elegido
                              ? "Ninguna tiene stock suficiente: elige una igual o cambia las piezas."
                              : null}
                    </p>
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-3" aria-label="Formatos de plancha">
                    {mostrados.map((c) => (
                      <li key={c.formato.codigo}>
                        <TarjetaFormato
                          calculo={c}
                          elegido={elegido?.formato.codigo === c.formato.codigo}
                          validando={validando}
                          hay={stock ? (stock[c.formato.codigo] ?? null) : undefined}
                          compartido={
                            grupo.formatos.find((f) => f.codigo === c.formato.codigo)?.skuCompartido ?? false
                          }
                          alElegir={() => setAMano(c.formato.codigo)}
                        />
                      </li>
                    ))}
                  </ul>
                  {sinOdoo.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      Sin producto en Odoo, y por eso fuera de la comparación: {sinOdoo.map((f) => f.codigo).join(", ")}.
                    </p>
                  )}
                </div>
              )}

              {/* 5. El elegido, en detalle */}
              {elegido && !elegido.problema && (
                <div className="flex flex-col gap-3">
                  <dl className="bg-muted/30 flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm">
                    {elegido.desglose.map((d, i) => (
                      <div key={i} className={cn("flex items-baseline justify-between gap-4", d.esTotal && "border-t pt-1.5")}>
                        <dt className={d.esTotal ? "font-medium" : "text-muted-foreground"}>{d.etiqueta}</dt>
                        <dd className={cn("tnum shrink-0", d.esTotal && "text-base font-semibold")}>{money(d.monto)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {elegido.planchas.slice(0, 4).map((p, i) => (
                      <figure key={i} className="flex flex-col gap-1">
                        <PlanoCorte plancha={p} titulo={`Plancha ${i + 1} de ${elegido.planchas.length}`} />
                        <figcaption className="text-muted-foreground text-xs">
                          Plancha {i + 1} · {p.piezas} {p.piezas === 1 ? "pieza" : "piezas"} · {Math.round(p.usoPct)} % usado
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  {elegido.planchas.length > 4 && (
                    <p className="text-muted-foreground text-xs">
                      Y {elegido.planchas.length - 4} planchas más. El plano completo queda en el pedido.
                    </p>
                  )}
                  <LeyendaPlano conSobrante={elegido.planchas.some((p) => p.cobro.factor < 1)} />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="m-0 flex-row items-center border-t px-5 py-3">
          <div className="min-w-0 flex-1">
            {elegido && !elegido.problema ? (
              <>
                <p className="text-muted-foreground text-xs">
                  {elegido.planchas.length} {elegido.planchas.length === 1 ? "plancha" : "planchas"} de{" "}
                  {elegido.formato.ancho}×{elegido.formato.alto} · {elegido.piezas}{" "}
                  {elegido.piezas === 1 ? "pieza" : "piezas"}
                </p>
                <p className="tnum text-lg leading-tight font-semibold" data-testid="total-corte">
                  {money(elegido.total)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">{elegido?.problema ?? "Todavía no hay un corte que agregar."}</p>
            )}
          </div>
          {/* En el celular basta la X de arriba: aquí el ancho es para el total. */}
          <Button type="button" variant="ghost" onClick={alCerrar} className="hidden sm:inline-flex">
            <X />
            Cancelar
          </Button>
          <Button type="button" onClick={guardar} disabled={!listo}>
            {inicial ? "Guardar corte" : "Agregar corte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TarjetaFormato({
  calculo: c,
  elegido,
  validando,
  hay,
  compartido,
  alElegir,
}: {
  calculo: CalculoCorte;
  elegido: boolean;
  validando: boolean;
  /** `undefined`: Odoo todavía no contesta. `null`: Odoo no lleva ese stock. */
  hay: number | null | undefined;
  compartido: boolean;
  alElegir: () => void;
}) {
  const necesita = c.planchas.length;
  const alcanza = typeof hay === "number" && hay >= necesita;

  return (
    <button
      type="button"
      aria-pressed={elegido}
      // Hasta que Odoo conteste no se elige: el check es lo que da paso.
      disabled={validando || !!c.problema}
      onClick={alElegir}
      className={cn(
        "flex h-full w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:cursor-default",
        elegido ? "border-primary/60 bg-primary/8" : "enabled:hover:border-foreground/25",
        c.problema && "opacity-60",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="tnum text-sm font-medium">
          {c.formato.ancho}×{c.formato.alto}
        </span>
        <span className="text-muted-foreground font-mono text-2xs">{c.formato.codigo}</span>
      </span>

      {c.problema ? (
        <span className="text-destructive text-xs">{c.problema}</span>
      ) : (
        <>
          <span className="tnum text-base font-semibold">{money(c.total)}</span>
          <span className="text-muted-foreground text-xs">
            {necesita} {necesita === 1 ? "plancha" : "planchas"} · {Math.round(c.desperdicioPct)} % de retazo
          </span>
        </>
      )}

      <span className="mt-auto flex items-center gap-1.5 pt-1 text-xs">
        {hay === undefined ? (
          <>
            <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
            <span className="text-muted-foreground">Validando stock…</span>
          </>
        ) : hay === null ? (
          <>
            <CircleAlert className="text-muted-foreground size-3.5" />
            <span className="text-muted-foreground">Odoo no lleva su stock</span>
          </>
        ) : alcanza ? (
          <>
            <Check className="text-st-entregado size-3.5" />
            <span className="text-st-entregado font-medium">
              Hay {hay}
              {compartido && <span className="text-muted-foreground font-normal"> · entre todos los colores</span>}
            </span>
          </>
        ) : (
          <>
            <CircleAlert className="text-destructive size-3.5" />
            <span className="text-destructive font-medium">
              {hay <= 0 ? "Sin stock" : `Solo hay ${hay}`}
              {compartido && <span className="text-muted-foreground font-normal"> · entre todos los colores</span>}
            </span>
          </>
        )}
      </span>
    </button>
  );
}
