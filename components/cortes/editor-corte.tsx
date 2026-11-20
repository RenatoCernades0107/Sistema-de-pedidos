"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import type { RespuestaPrecios } from "@/app/api/cortes/precios/route";
import {
  MODALIDADES,
  calcularConSobrante,
  compararFormatos,
  type CalculoCorte,
  type EleccionPlancha,
  type Modalidad,
  type PiezaPedida,
} from "@/lib/cortes/calcular";
import {
  buscarGrupos,
  colorDe,
  espesorTexto,
  medidaDe,
  nombreDeGrupo,
  type GrupoPlancha,
} from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { LUGARES_CORTE, lugarDeCorte, planchasNuevas, planchasTexto, type LugarCorte } from "@/lib/cortes/guardado";
import { contenedoresDe } from "@/lib/sobrantes";
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
import { useCerrarConAviso } from "@/components/ui/confirmar-descarte";
import { OpcionesPlancha, useStock, type OpcionSobrante } from "./opciones-plancha";
import { PlanosPaginados } from "./planos-paginados";

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
type Sobrantes = RespuestaPrecios["sobrantes"];
const SIN_SOBRANTES: Sobrantes = { taller: [], tienda: [] };

/** Los precios de un material no cambian mientras se arma un corte: se piden una vez. */
const preciosVistos = new Map<string, { precios: Precios; sobrantes: Sobrantes }>();

export function usePrecios(grupoId: string | null) {
  const [estado, setEstado] = useState<{
    grupoId: string;
    precios: Precios | null;
    sobrantes: Sobrantes;
    error: string | null;
  } | null>(null);

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
          setEstado({ grupoId, precios: null, sobrantes: SIN_SOBRANTES, error: json.error ?? "No se pudieron leer los precios." });
          return;
        }
        preciosVistos.set(grupoId, { precios: json.precios, sobrantes: json.sobrantes ?? SIN_SOBRANTES });
        setEstado({ grupoId, precios: json.precios, sobrantes: json.sobrantes ?? SIN_SOBRANTES, error: null });
      } catch {
        if (!ctrl.signal.aborted) {
          setEstado({ grupoId, precios: null, sobrantes: SIN_SOBRANTES, error: "No se pudieron leer los precios. Revisa la conexión." });
        }
      }
    })();
    return () => ctrl.abort();
  }, [grupoId]);

  const nada = { precios: null, sobrantes: SIN_SOBRANTES, error: null };
  if (!grupoId) return nada;
  const visto = preciosVistos.get(grupoId);
  if (visto) return { ...visto, error: null };
  return estado?.grupoId === grupoId ? estado : nada;
}

/* ── El editor ─────────────────────────────────────────────────────────────── */

/**
 * Arma un corte a medida: de qué material, cómo se corta y qué piezas.
 *
 * El cálculo corre aquí mismo, a cada tecla, sobre todos los formatos de plancha
 * de ese material. De ahí salen los tres más convenientes, y solo por esos se le
 * pregunta a Odoo si hay stock —una vez, por los tres—. Queda elegido el más
 * pequeño que tenga planchas suficientes.
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
  const [modalidad, setModalidad] = useState<Modalidad>(inicial?.modalidad ?? "laser");
  /** Dónde se hace un corte manual. El láser va siempre al taller. */
  const [lugarManual, setLugarManual] = useState<LugarCorte>(inicial?.lugar ?? "tienda");
  const lugar = lugarDeCorte({ modalidad, lugar: lugarManual });
  const [filas, setFilas] = useState<FilaPieza[]>(() =>
    inicial
      ? inicial.piezas.map((p) => ({ ancho: String(p.ancho), alto: String(p.alto), cantidad: String(p.cantidad) }))
      : [FILA_VACIA],
  );
  /** La plancha o el sobrante que eligió la persona. Mientras sea `null`, manda la sugerencia. */
  const [eleccion, setEleccion] = useState<EleccionPlancha | null>(inicial?.eleccion ?? null);

  const anchos = useRef(new Map<number, HTMLInputElement>());
  /**
   * La fila que tiene que recibir el foco en cuanto exista. No se puede enfocar
   * en el momento: la fila todavía no está pintada cuando se pide.
   */
  const porEnfocar = useRef<number | null>(null);
  const buscador = useRef<HTMLInputElement>(null);

  const grupo = catalogo.find((g) => g.id === grupoId) ?? null;
  const { precios, sobrantes, error: errorPrecios } = usePrecios(grupoId);
  const piezas = useMemo(() => piezasDe(filas), [filas]);

  const entrada = useMemo(
    () => (grupo ? { piezas, espesorMm: grupo.espesorMm, modalidad, rotable: grupo.rotable } : null),
    [grupo, piezas, modalidad],
  );
  const formatos = useMemo(
    () =>
      grupo && precios
        ? grupo.formatos
            .filter((f) => precios[f.codigo])
            .map((f) => ({ codigo: f.codigo, ancho: f.anchoCm, alto: f.largoCm, precio: precios[f.codigo].precio }))
        : [],
    [grupo, precios],
  );
  // Los sobrantes del almacén donde se corta.
  const delAlmacen = useMemo(
    () => (grupo?.sobrantesActivo ? sobrantes[lugar] : []),
    [grupo, sobrantes, lugar],
  );

  /** La sugerencia: la plancha más chica que sirva, con los sobrantes primero. */
  const calculos = useMemo(() => {
    if (!entrada || piezas.length === 0) return [];
    // La plancha más chica que sirva: las grandes se guardan para las medidas grandes.
    return compararFormatos(entrada, formatos, config, contenedoresDe(delAlmacen), "tamano");
  }, [entrada, piezas, formatos, config, delAlmacen]);

  /** Cada formato, solo con planchas nuevas: lo que pasa si se elige ese. */
  const porFormato = useMemo(() => {
    if (!entrada || piezas.length === 0) return [];
    return compararFormatos(entrada, formatos, config, [], "tamano");
  }, [entrada, piezas, formatos, config]);

  /** Cada sobrante, primero él y lo demás de la plancha más chica que sirva. */
  const opcionesSobrante: OpcionSobrante[] = useMemo(() => {
    const base = porFormato[0];
    return delAlmacen.map((s) => ({
      codigo: s.codigo,
      largo: s.largo,
      ancho: s.ancho,
      calculo:
        entrada && base
          ? calcularConSobrante(entrada, base.formato, config, contenedoresDe([s])[0])
          : null,
    }));
  }, [delAlmacen, porFormato, entrada, config]);

  const { stock, porAlmacen, validando, fallo: falloStock } = useStock(formatos.map((f) => f.codigo));

  const alcanza = (c: CalculoCorte) => {
    const necesita = planchasNuevas(c);
    if (necesita === 0) return true;
    const hay = stock?.[c.formato.codigo];
    return typeof hay === "number" && hay >= necesita;
  };
  // Sin respuesta de Odoo no se sugiere nada: la sugerencia es "el mejor con stock".
  const sugerido = stock ? (calculos.find((c) => !c.problema && alcanza(c)) ?? null) : null;
  const elegido =
    eleccion === null
      ? sugerido
      : eleccion.tipo === "formato"
        ? (porFormato.find((c) => c.formato.codigo === eleccion.codigo) ?? null)
        : (opcionesSobrante.find((o) => o.codigo === eleccion.codigo)?.calculo ?? null);

  const sinOdoo = grupo && precios ? grupo.formatos.filter((f) => !precios[f.codigo]) : [];
  const listo = !!grupo && !!elegido && !elegido.problema;

  const elegirGrupo = (g: GrupoPlancha) => {
    setGrupoId(g.id);
    setConsulta("");
    setEleccion(null);
    // Con el material elegido, lo siguiente son las medidas.
    porEnfocar.current = 0;
  };

  const cambiarFila = (i: number, cambios: Partial<FilaPieza>) => {
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
    setEleccion(null);
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
      color: colorDe(grupo),
      espesorMm: grupo.espesorMm,
      rotable: grupo.rotable,
      modalidad,
      lugar,
      piezas,
      eleccion,
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

  /* Cerrar con medidas escritas o el material cambiado pregunta antes: se perdería. */
  const [filasIniciales] = useState(filas);
  const sucio =
    grupoId !== (inicial?.grupoId ?? null) ||
    modalidad !== (inicial?.modalidad ?? "laser") ||
    lugarManual !== (inicial?.lugar ?? "tienda") ||
    JSON.stringify(eleccion) !== JSON.stringify(inicial?.eleccion ?? null) ||
    JSON.stringify(filas.filter((f) => f.ancho || f.alto || f.cantidad)) !==
      JSON.stringify(filasIniciales.filter((f) => f.ancho || f.alto || f.cantidad));
  const { pedirCierre, dialogo } = useCerrarConAviso(sucio, alCerrar, {
    titulo: inicial ? "¿Descartar los cambios del corte?" : "¿Descartar este corte?",
    descripcion: inicial
      ? "El corte se queda como estaba y lo que cambiaste se pierde."
      : "No se agrega y las medidas que escribiste se pierden.",
  });

  return (
    <>
    {dialogo}
    <Dialog open onOpenChange={(abierto) => !abierto && pedirCierre()}>
      <DialogContent
        className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl lg:max-w-6xl"
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

        {/*
          Dos columnas desde `lg`: a la izquierda el formulario y a la derecha el
          plano, cada una con su propio scroll para ver el plano mientras se
          escriben las piezas. Por debajo de `lg` se apilan y scrollea todo junto.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-2 lg:overflow-hidden">
        <div className="flex flex-col gap-5 px-5 py-4 lg:min-h-0 lg:overflow-y-auto">
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
                      setEleccion(null);
                    }}
                  >
                    Cambiar
                  </Button>
                </p>
              </div>
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
                    setEleccion(null);
                  }}
                  opciones={Object.entries(MODALIDADES).map(([valor, label]) => ({ valor, label }))}
                />
              </Campo>
              {modalidad === "manual" ? (
                <Campo grupo label="Dónde se corta">
                  <Opciones
                    valores={[lugarManual]}
                    onToggle={(v) => {
                      setLugarManual(v as LugarCorte);
                      setEleccion(null);
                    }}
                    opciones={Object.entries(LUGARES_CORTE).map(([valor, label]) => ({ valor, label }))}
                  />
                </Campo>
              ) : (
                <p className="text-muted-foreground -mt-2 text-xs">El corte láser se hace en el taller.</p>
              )}

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
                            setEleccion(null);
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

              {porFormato.length > 0 && (
                <div className="flex flex-col gap-2">
                  <OpcionesPlancha
                    formatos={porFormato}
                    sobrantes={opcionesSobrante}
                    almacenSobrantes={lugar}
                    sugerido={sugerido}
                    eleccion={eleccion}
                    alElegir={setEleccion}
                    stock={stock}
                    porAlmacen={porAlmacen}
                    validando={validando}
                    falloStock={falloStock}
                  />
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
                  {elegido.planchas.some((p) => p.origen.tipo === "sobrante") && (
                    <p className="text-muted-foreground text-xs">
                      El precio es el de planchas nuevas; el corte sale en parte de sobrantes del almacén, que quedan
                      reservados al registrar el pedido.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* El plano: a la derecha en pantallas anchas, debajo en el celular. */}
        <div className="bg-muted/20 border-t px-5 py-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          {elegido && !elegido.problema ? (
            <PlanosPaginados planchas={elegido.planchas} />
          ) : (
            <p className="text-muted-foreground hidden min-h-48 items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center text-sm lg:flex lg:h-full">
              El plano del corte aparecerá aquí cuando haya piezas y una plancha elegida.
            </p>
          )}
        </div>
        </div>

        <DialogFooter className="m-0 flex-row items-center border-t px-5 py-3">
          <div className="min-w-0 flex-1">
            {elegido && !elegido.problema ? (
              <>
                <p className="text-muted-foreground text-xs">
                  {planchasTexto(elegido)} · {elegido.piezas} {elegido.piezas === 1 ? "pieza" : "piezas"}
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
          <Button type="button" variant="ghost" onClick={pedirCierre} className="hidden sm:inline-flex">
            <X />
            Cancelar
          </Button>
          <Button type="button" onClick={guardar} disabled={!listo}>
            {inicial ? "Guardar corte" : "Agregar corte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
