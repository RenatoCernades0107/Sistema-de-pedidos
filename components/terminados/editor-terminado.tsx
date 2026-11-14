"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box, CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import {
  buscarGrupos,
  colorDe,
  espesorTexto,
  nombreDeGrupo,
  pideColor,
  type GrupoPlancha,
} from "@/lib/cortes/catalogo";
import { money } from "@/lib/formato";
import type { LineaTerminado } from "@/lib/lineas-cotizacion";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import type { ConfigCortes } from "@/lib/cortes/config";
import {
  calcularTerminado,
  formatosConPrecio,
  planchaDeReferencia,
  type Accesorio,
} from "@/lib/terminados/calcular";
import {
  CLASES_OPCION,
  buscarProductos,
  espesorRecomendado,
  medidasDe,
  opcionesDeProducto,
  textoDeEspesor,
  textoDeMedidaEstandar,
  type CatalogoTerminados,
  type ClaseOpcion,
  type MedidaEstandar,
  type ProductoEstandar,
} from "@/lib/terminados/catalogo";
import {
  ETIQUETA_MEDIDA,
  GEOMETRIAS,
  type CampoMedida,
  type Geometria,
  type Medidas,
} from "@/lib/terminados/geometria";
import { cn } from "@/lib/utils";
import { usePrecios } from "@/components/cortes/editor-corte";
import { ArmadoCaja } from "@/components/terminados/armado-caja";
import { SinModelo } from "@/components/terminados/sin-modelo";
import { CortesTerminado } from "@/components/terminados/cortes-terminado";
import {
  PiezasModeloCad,
  VisorModeloCad,
  useModeloCad,
} from "@/components/terminados/modelo-cad-terminado";
import { parametrosCadDe } from "@/lib/terminados/plantilla-cad";
import { armadoDeCaja } from "@/lib/terminados/armado";
import { BuscadorProducto } from "@/components/cotizaciones/buscador-producto";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type TerminadoNuevo = Omit<LineaTerminado, "tipo" | "clave"> & { clave?: string };

type TextoMedidas = Record<CampoMedida, string>;

const SIN_MEDIDAS: TextoMedidas = { m1: "", m2: "", m3: "", diametro: "", altura: "", letras: "" };
const CAMPOS: CampoMedida[] = ["m1", "m2", "m3", "diametro", "altura", "letras"];
const OTRA_MEDIDA = "otra";

const aNumero = (t: string) => {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const texto = (n: number | null | undefined) => (n ? String(n) : "");

function aTexto(m: Medidas): TextoMedidas {
  return {
    m1: texto(m.m1),
    m2: texto(m.m2),
    m3: texto(m.m3),
    diametro: texto(m.diametro),
    altura: texto(m.altura),
    letras: texto(m.letras),
  };
}

function aMedidas(t: TextoMedidas): Medidas {
  const salida: Medidas = {};
  for (const k of CAMPOS) {
    const n = aNumero(t[k]);
    if (n) salida[k] = k === "letras" ? Math.floor(n) : n;
  }
  return salida;
}

/** Las medidas de una fila del catálogo, en los campos que usa la forma del producto. */
function medidasDeFila(m: MedidaEstandar, geometria: Geometria): Medidas {
  const base = medidasDe(m);
  // El tambor viene como diámetro × largo: en el cilindro, el largo es la altura.
  if (geometria === "cilindro" && !base.altura && base.m1) return { diametro: base.diametro, altura: base.m1 };
  return base;
}

/** Los campos de medida que se piden: los de la forma, más los que traiga la medida estándar. */
function camposDe(geometria: Geometria, producto: ProductoEstandar | null): CampoMedida[] {
  const campos = new Set<CampoMedida>(GEOMETRIAS[geometria].campos);
  if (producto && geometria === "manual") {
    for (const m of producto.medidas) {
      for (const k of CAMPOS) if (medidasDeFila(m, geometria)[k]) campos.add(k);
    }
  }
  return CAMPOS.filter((k) => campos.has(k));
}

type Pestana = "producto" | "modelo" | "piezas" | "materiales";

/** Si la pantalla es lo bastante ancha para las dos columnas (`lg` de Tailwind). */
const ANCHO_LG = "(min-width: 64rem)";
function useEsAncho() {
  return useSyncExternalStore(
    (avisar) => {
      const mq = window.matchMedia(ANCHO_LG);
      mq.addEventListener("change", avisar);
      return () => mq.removeEventListener("change", avisar);
    },
    () => window.matchMedia(ANCHO_LG).matches,
    () => true,
  );
}

/** Dónde se recuerda la última pestaña abierta, en este navegador. */
const CLAVE_PESTANA = "editor-terminado:pestana";
const PESTANAS_GUARDABLES: Pestana[] = ["producto", "piezas", "materiales"];

function pestanaGuardada(): Pestana {
  try {
    const v = window.localStorage.getItem(CLAVE_PESTANA) as Pestana | null;
    return v && PESTANAS_GUARDABLES.includes(v) ? v : "producto";
  } catch {
    return "producto";
  }
}

function guardarPestana(p: Pestana) {
  if (!PESTANAS_GUARDABLES.includes(p)) return;
  try {
    window.localStorage.setItem(CLAVE_PESTANA, p);
  } catch {
    // Sin almacenamiento (ventana privada, bloqueado): no se recuerda y ya.
  }
}

/** Un aviso en una pestaña: algo de adentro necesita atención. */
function Punto({ motivo }: { motivo: string }) {
  return (
    <span className="bg-destructive inline-block size-1.5 shrink-0 rounded-full" title={motivo}>
      <span className="sr-only">({motivo})</span>
    </span>
  );
}

/** Lo que ocupa el lugar del modelo 3D cuando no lo hay. */
function SinVistaPrevia({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <Box className="size-8 opacity-60" aria-hidden />
      <p className="text-foreground/80 max-w-72 text-sm font-medium">{titulo}</p>
      {detalle && <p className="max-w-72 text-xs">{detalle}</p>}
    </div>
  );
}

/**
 * Arma un producto terminado: uno estándar del catálogo —se elige el producto,
 * la medida, el material y las opciones— o uno personalizado, que se llena a
 * mano.
 *
 * El material estimado y el precio sugerido se calculan aquí a cada cambio, con
 * el precio de la plancha que da Odoo. El precio final lo decide quien cotiza:
 * arranca en el sugerido y se puede escribir otro.
 */
export function EditorTerminado({
  catalogo,
  planchas,
  configCortes,
  inicial,
  alGuardar,
  alCerrar,
}: {
  catalogo: CatalogoTerminados;
  planchas: GrupoPlancha[];
  /** Con esto se acomodan las piezas en la plancha, como en un corte. */
  configCortes: ConfigCortes;
  /** El que se está editando; `null` para uno nuevo. */
  inicial: LineaTerminado | null;
  alGuardar: (terminado: TerminadoNuevo) => void;
  alCerrar: () => void;
}) {
  const [estandar, setEstandar] = useState(inicial ? !!inicial.productoCodigo : true);
  const [tipoCodigo, setTipoCodigo] = useState<string | null>(inicial?.tipoCodigo ?? null);
  const [productoCodigo, setProductoCodigo] = useState<string | null>(inicial?.productoCodigo ?? null);
  const [buscado, setBuscado] = useState("");
  const [nombre, setNombre] = useState(inicial && !inicial.productoCodigo ? inicial.nombre : "");
  const [medidaId, setMedidaId] = useState<string | null>(inicial ? OTRA_MEDIDA : null);
  const [medidas, setMedidas] = useState<TextoMedidas>(inicial ? aTexto(inicial.medidas) : SIN_MEDIDAS);
  const [grupoId, setGrupoId] = useState<string | null>(inicial?.grupoId ?? null);
  const [consulta, setConsulta] = useState("");
  const [color, setColor] = useState(inicial?.color ?? "");
  const [opciones, setOpciones] = useState<number[]>(inicial?.opciones ?? []);
  const [textoPedido, setTextoPedido] = useState(inicial?.texto ?? "");
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [areaManual, setAreaManual] = useState(texto(inicial?.areaManualM2));
  const [accesorios, setAccesorios] = useState<Accesorio[]>(inicial?.accesorios ?? []);
  const [cantidad, setCantidad] = useState(inicial ? String(inicial.cantidad) : "1");
  /** El precio escrito a mano. Vacío: vale el sugerido. */
  const [precio, setPrecio] = useState(
    inicial && inicial.precioUnitario !== inicial.calculo.precioSugerido ? String(inicial.precioUnitario) : "",
  );
  const [reservar, setReservar] = useState(inicial?.reservar ?? false);
  const [buscandoAccesorio, setBuscandoAccesorio] = useState(false);

  const producto = estandar ? (catalogo.productos.find((p) => p.codigo === productoCodigo) ?? null) : null;
  const tipo = catalogo.tipos.find((t) => t.codigo === (producto?.tipo ?? tipoCodigo)) ?? null;
  const geometria: Geometria = producto?.geometria ?? "manual";
  const grupo = planchas.find((g) => g.id === grupoId) ?? null;
  const conColor = grupo ? pideColor(grupo) : false;
  const { precios, error: errorPrecios } = usePrecios(grupoId);

  const plancha = useMemo(
    () => (grupo && precios ? planchaDeReferencia(grupo.formatos, new Map(Object.entries(precios))) : null),
    [grupo, precios],
  );
  const formatos = useMemo(
    () => (grupo && precios ? formatosConPrecio(grupo.formatos, new Map(Object.entries(precios))) : []),
    [grupo, precios],
  );

  const delProducto = useMemo(
    () => (producto ? opcionesDeProducto(catalogo, producto) : null),
    [catalogo, producto],
  );
  /** En un personalizado se ofrece todo el catálogo de opciones. */
  const porClase = useMemo(() => {
    const salida: Record<ClaseOpcion, { id: number; nombre: string; extra: number }[]> = {
      personalizacion: [],
      acabado: [],
      complemento: [],
    };
    if (delProducto) {
      for (const clase of Object.keys(salida) as ClaseOpcion[]) salida[clase] = delProducto[clase];
    } else {
      for (const o of catalogo.opciones) salida[o.clase].push(o);
    }
    return salida;
  }, [catalogo, delProducto]);

  const elegidas = catalogo.opciones.filter((o) => opciones.includes(o.id));
  const unidades = Math.floor(aNumero(cantidad) ?? 0);
  const calculo = useMemo(
    () =>
      calcularTerminado({
        geometria,
        medidas: aMedidas(medidas),
        areaManualM2: aNumero(areaManual),
        cantidad: unidades,
        plancha,
        accesorios,
        factor: tipo?.factor ?? 1,
        extras: catalogo.opciones.filter((o) => opciones.includes(o.id)).map((o) => o.extra),
        mermaPct: catalogo.config.mermaPct,
        anchoDeLetra: catalogo.config.anchoDeLetra,
        formatos,
        configCortes,
        espesorMm: grupo?.espesorMm,
      }),
    [geometria, medidas, areaManual, unidades, plancha, accesorios, tipo, catalogo, opciones, formatos, configCortes, grupo],
  );

  /** Si el producto lo dibuja una plantilla del motor CAD: sus parámetros en mm. */
  const parametrosCad = useMemo(
    () =>
      producto?.plantillaCad
        ? parametrosCadDe(producto, aMedidas(medidas), { espesorMm: grupo?.espesorMm, texto: textoPedido })
        : null,
    [producto, medidas, grupo, textoPedido],
  );
  const modeloCad = useModeloCad(producto?.plantillaCad ?? null, parametrosCad);
  // Mientras el motor no conteste —o si no puede— las piezas son la estimación por forma.
  const conModeloCad = modeloCad.tipo === "listo";
  /** La pieza bajo el mouse (en el 3D o en la tabla) y la que se fijó con un clic en el 3D. */
  const [piezaHover, setPiezaHover] = useState<string | null>(null);
  const [piezaFijada, setPiezaFijada] = useState<string | null>(null);
  const piezaActiva = piezaHover ?? piezaFijada;
  const [pestana, setPestanaCruda] = useState<Pestana>(pestanaGuardada);
  const setPestana = useCallback((p: Pestana) => {
    setPestanaCruda(p);
    guardarPestana(p);
  }, []);
  const panelPiezas = useRef<HTMLDivElement>(null);
  const esAncho = useEsAncho();
  /** Al abrir el buscador de accesorios, el cursor va directo a él. */
  const enfocar = useCallback((el: HTMLInputElement | null) => el?.focus(), []);

  const precioFinal = precio.trim() === "" ? calculo.precioSugerido : Number(precio.replace(",", "."));
  const precioValido = Number.isFinite(precioFinal) && precioFinal >= 0;

  const problema = !estandar
    ? !nombre.trim()
      ? "Escribe qué producto es."
      : null
    : !producto
      ? "Elige el producto."
      : !grupo
        ? "Elige el material."
        : conColor && !color.trim()
          ? "Escribe el color."
          : null;
  const falta = problema ?? (unidades < 1 ? "Escribe la cantidad." : !precioValido ? "El precio no es válido." : null);

  const elegirProducto = (p: ProductoEstandar) => {
    setProductoCodigo(p.codigo);
    setTipoCodigo(p.tipo);
    setBuscado("");
    setMedidaId(null);
    setMedidas(SIN_MEDIDAS);
    setAreaManual("");
    // Lo que el producto trae siempre viene marcado.
    setOpciones(p.opciones.filter((o) => !o.opcional).map((o) => o.opcionId));
  };

  const elegirMedida = (id: string) => {
    setMedidaId(id);
    const fila = producto?.medidas.find((m) => m.id === id);
    if (fila) setMedidas({ ...aTexto(medidasDeFila(fila, geometria)), letras: medidas.letras });
  };

  const agregarAccesorio = (p: ProductoOdoo) =>
    setAccesorios((as) =>
      as.some((a) => a.productoId === p.id)
        ? as
        : [...as, { productoId: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: 1, precio: p.precio }],
    );

  const guardar = () => {
    if (falta) return;
    alGuardar({
      clave: inicial?.clave,
      productoCodigo: producto?.codigo ?? null,
      tipoCodigo: tipo?.codigo ?? null,
      nombre: producto?.nombre ?? nombre.trim(),
      geometria,
      medidas: aMedidas(medidas),
      grupoId: grupo?.id ?? null,
      materialTexto: grupo ? nombreDeGrupo(grupo) : "",
      color: grupo ? (conColor ? color.trim() : colorDe(grupo)) : null,
      opciones: elegidas.map((o) => o.id),
      opcionesTexto: elegidas.map((o) => o.nombre),
      texto: textoPedido,
      notas,
      areaManualM2: aNumero(areaManual),
      accesorios,
      cantidad: unidades,
      precioUnitario: Math.round(precioFinal * 100) / 100,
      reservar,
      calculo,
      // El enlace al diseño CAD se conserva mientras siga siendo un personalizado.
      disenoVersionId: producto ? null : (inicial?.disenoVersionId ?? null),
    });
  };

  const productosDelTipo = useMemo(
    () =>
      buscarProductos(
        catalogo.productos.filter((p) => !tipoCodigo || p.tipo === tipoCodigo),
        buscado,
      ),
    [catalogo, tipoCodigo, buscado],
  );

  const opcionesDeMaterial: Opcion[] = useMemo(
    () =>
      buscarGrupos(planchas, consulta).map((g) => ({
        valor: g.id,
        alElegir: () => {
          setGrupoId(g.id);
          setConsulta("");
          setColor(pideColor(g) ? g.detalle : "");
        },
        contenido: (
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{g.material}</span>
            <span>{colorDe(g)}</span>
            <span className="tnum">{espesorTexto(g.espesorMm)}</span>
            {producto && espesorRecomendado(producto, g.espesorMm) && (
              <span className="text-primary ml-auto text-xs">Espesor recomendado</span>
            )}
          </span>
        ),
      })),
    [planchas, consulta, producto],
  );

  const campos = camposDe(geometria, producto);
  const conDatos = !!producto || !estandar;

  /** Columna izquierda: lo que define el producto. */
  const datos = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <Campo grupo label="Clase">
          <Opciones
            valores={[estandar ? "estandar" : "personalizado"]}
            onToggle={(v) => {
              setEstandar(v === "estandar");
              setOpciones([]);
            }}
            opciones={[
              { valor: "estandar", label: "Estándar" },
              { valor: "personalizado", label: "Personalizado" },
            ]}
          />
        </Campo>

        <Campo grupo label={estandar ? "Tipo" : "Tipo (opcional)"}>
          <Opciones
            valores={tipoCodigo ? [tipoCodigo] : []}
            onToggle={(v) => {
              setTipoCodigo(v === tipoCodigo && !estandar ? null : v);
              if (estandar && producto && producto.tipo !== v) setProductoCodigo(null);
            }}
            opciones={catalogo.tipos.map((t) => ({ valor: t.codigo, label: t.nombre }))}
          />
        </Campo>
      </div>

      {/* El producto */}
      {estandar ? (
        producto ? (
          <div>
            <p className="text-xs font-medium">Producto</p>
            <p
              className="bg-muted/50 mt-1.5 flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              data-testid="producto-elegido"
            >
              <span className="bg-background shrink-0 rounded border px-1.5 py-px font-mono text-xs">
                {producto.codigo}
              </span>
              <span className="min-w-0 flex-1 font-medium">{producto.nombre}</span>
              {!producto.plantillaCad && <SinModelo />}
              <Button type="button" variant="ghost" size="xs" onClick={() => setProductoCodigo(null)}>
                Cambiar
              </Button>
            </p>
            {(producto.usos || producto.notas || producto.aMedida) && (
              <p className="text-muted-foreground mt-1 text-xs">
                {[
                  producto.aMedida ? "Se fabrica a medida: las medidas son una referencia." : null,
                  producto.usos ? `Usos: ${producto.usos}.` : null,
                  producto.notas,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">Producto</p>
            <Input
              value={buscado}
              onChange={(e) => setBuscado(e.target.value)}
              placeholder="Buscar por nombre o código…"
              aria-label="Buscar producto terminado"
              autoFocus
            />
            <ul className="max-h-72 overflow-y-auto rounded-lg border" aria-label="Productos del catálogo">
              {productosDelTipo.map((p) => (
                <li key={p.codigo} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => elegirProducto(p)}
                    className="hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <span className="bg-muted/60 shrink-0 rounded border px-1.5 py-px font-mono text-xs">
                      {p.codigo}
                    </span>
                    <span className="min-w-0 flex-1">{p.nombre}</span>
                    {!p.plantillaCad && <SinModelo />}
                  </button>
                </li>
              ))}
              {productosDelTipo.length === 0 && (
                <li className="text-muted-foreground px-3 py-4 text-center text-sm">
                  Ningún producto coincide. Si tiene otra forma, es un personalizado.
                </li>
              )}
            </ul>
          </div>
        )
      ) : (
        <Campo label="Nombre del producto" requerido>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={160}
            placeholder="Ej. Exhibidor de tres cuerpos con puerta corrediza"
            autoFocus
          />
        </Campo>
      )}

      {conDatos && (
        <>
          {/* Medidas */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">
              Medidas <span className="text-muted-foreground font-normal">(en centímetros)</span>
            </p>
            {producto && producto.medidas.length > 0 && (
              <Opciones
                valores={medidaId ? [medidaId] : []}
                onToggle={elegirMedida}
                opciones={[
                  ...producto.medidas.map((m) => ({ valor: m.id, label: textoDeMedidaEstandar(m) })),
                  { valor: OTRA_MEDIDA, label: "Otra medida" },
                ]}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {campos.map((k) => (
                <Campo key={k} label={ETIQUETA_MEDIDA[k]} className="w-28">
                  <Input
                    inputMode="decimal"
                    value={medidas[k]}
                    onChange={(e) => {
                      setMedidas((m) => ({ ...m, [k]: e.target.value }));
                      if (k !== "letras") setMedidaId(OTRA_MEDIDA);
                    }}
                    className="tnum"
                  />
                </Campo>
              ))}
            </div>
          </div>

          {/* Material */}
          {grupo ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">Material</p>
                <p
                  className="bg-muted/50 mt-1.5 flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm"
                  data-testid="material-elegido"
                >
                  <span className="min-w-0 flex-1 font-medium">{nombreDeGrupo(grupo)}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setGrupoId(null)}>
                    Cambiar
                  </Button>
                </p>
              </div>
              {conColor && (
                <Campo label="Color" requerido className="w-40">
                  <Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={60} />
                </Campo>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium">
                Material {!estandar && <span className="text-muted-foreground font-normal">(opcional)</span>}
              </p>
              <ComboBusqueda
                etiqueta="Buscar material"
                placeholder="Material, color y espesor: eco cristal 3…"
                consulta={consulta}
                alEscribir={setConsulta}
                opciones={opcionesDeMaterial}
                cargando={false}
                error={null}
                vacio="Ningún material coincide. Los materiales se administran en Configuración."
                fresco
                enLinea
              />
              {producto && (producto.espesores.length > 0 || producto.colores.length > 0) && (
                <p className="text-muted-foreground text-xs">
                  {producto.espesores.length > 0 &&
                    `Espesores recomendados: ${producto.espesores.map(textoDeEspesor).join(", ")}. `}
                  {producto.colores.length > 0 && `Se hace en: ${producto.colores.join(", ").toLowerCase()}.`}
                </p>
              )}
            </div>
          )}
          {errorPrecios && (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <CircleAlert className="size-3.5" />
              {errorPrecios}
            </p>
          )}

          {/* Opciones */}
          {(Object.keys(CLASES_OPCION) as ClaseOpcion[]).map((clase) =>
            porClase[clase].length ? (
              <Campo key={clase} grupo label={CLASES_OPCION[clase]}>
                <Opciones
                  valores={opciones.map(String)}
                  onToggle={(v) =>
                    setOpciones((os) => (os.includes(Number(v)) ? os.filter((o) => o !== Number(v)) : [...os, Number(v)]))
                  }
                  opciones={porClase[clase].map((o) => ({
                    valor: String(o.id),
                    label: o.extra > 0 ? `${o.nombre} (+${money(o.extra)})` : o.nombre,
                  }))}
                />
              </Campo>
            ) : null,
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Texto" ayuda="Lo que dicen las letras o el letrero, tal cual va.">
              <Input value={textoPedido} onChange={(e) => setTextoPedido(e.target.value)} maxLength={300} />
            </Campo>
            <Campo label="Notas para el taller">
              <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} />
            </Campo>
          </div>
        </>
      )}
    </div>
  );

  const forma = GEOMETRIAS[geometria].nombre.toLowerCase();
  const resumenArea = !calculo.areaUnidadM2
    ? "Sin área: escribe las medidas o el área a mano."
    : calculo.corte
      ? `${calculo.areaUnidadM2} m²/u · ${forma}`
      : `${calculo.areaUnidadM2} m²/u${calculo.areaManual ? " (a mano)" : ` · ${forma}`} · ${calculo.areaTotalM2} m² con ${calculo.mermaPct}% de merma`;

  /** El material de una unidad: planchas y accesorios, sin los extras de las opciones. */
  const costoUnidad = unidades > 0 ? Math.round((calculo.costoMaterial / unidades) * 100) / 100 : 0;
  const margen = precioValido && precioFinal > 0 && costoUnidad > 0 ? (precioFinal - costoUnidad) / precioFinal : null;

  const totalPiezas =
    modeloCad.tipo === "listo"
      ? modeloCad.resultado.piezas.reduce((n, p) => n + p.cantidad, 0)
      : (calculo.piezas?.reduce((n, p) => n + p.cantidad, 0) ?? 0);

  // En pantalla ancha el modelo ya está a la derecha: la pestaña "Modelo" no existe.
  // Y Piezas y Materiales no se abren sin producto (la guardada puede ser una de ellas).
  const pestanaVisible: Pestana =
    (esAncho && pestana === "modelo") || (!conDatos && (pestana === "piezas" || pestana === "materiales"))
      ? "producto"
      : pestana;

  /** Por qué Materiales necesita atención, si es que la necesita. */
  const avisoMateriales = !conDatos
    ? null
    : estandar && !grupo
      ? "Falta elegir el material"
      : calculo.materiales.length === 0
        ? "Sin material estimado"
        : accesorios.some((a) => !(a.cantidad > 0))
          ? "Un accesorio tiene cantidad cero"
          : null;
  const avisoPiezas =
    modeloCad.tipo === "listo" && modeloCad.resultado.validaciones.some((v) => v.nivel === "error")
      ? "El diseño tiene errores"
      : null;

  /** Clic en una pieza del 3D: queda marcada y, si hay lugar, se ve en la pestaña Piezas. */
  const elegirPieza = useCallback(
    (id: string | null) => {
      setPiezaFijada(id);
      if (id && esAncho) setPestana("piezas");
    },
    [esAncho, setPestana],
  );
  useEffect(() => {
    if (!piezaFijada || pestanaVisible !== "piezas") return;
    panelPiezas.current
      ?.querySelector(`[data-pieza="${CSS.escape(piezaFijada)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [piezaFijada, pestanaVisible]);

  /** Pestaña Piezas: el despiece del motor o, sin él, la estimación por forma. */
  const piezas = (
    <div className="flex flex-col gap-4">
      {conModeloCad ? (
        <PiezasModeloCad resultado={modeloCad.resultado} piezaActiva={piezaActiva} alCambiarPieza={setPiezaHover} />
      ) : (
        <>
          {modeloCad.tipo === "cargando" && (
            <p className="text-muted-foreground text-xs" role="status">
              Generando el despiece del modelo…
            </p>
          )}
          {calculo.corte && calculo.piezas ? (
            <CortesTerminado
              piezas={calculo.piezas}
              formato={calculo.corte.formato}
              planchas={calculo.corte.planchas}
              compacto
              className="bg-background rounded-lg border p-3"
            />
          ) : (
            <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm">
              {calculo.areaUnidadM2
                ? `Esta forma no se despieza: el material se estima por área (${forma}).`
                : "Escribe las medidas para ver las piezas."}
            </p>
          )}
          {armadoDeCaja(geometria, aMedidas(medidas)) && (
            <details className="bg-background rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium">Cómo se arma (3D)</summary>
              <ArmadoCaja geometria={geometria} medidas={aMedidas(medidas)} className="mt-2" />
            </details>
          )}
        </>
      )}
    </div>
  );

  /** Pestaña Materiales: el área estimada, la plancha y los accesorios que se sacan de Odoo. */
  const materiales = (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5" aria-label="Material estimado">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Material estimado</p>
            <p className="text-muted-foreground tnum truncate text-xs" title={resumenArea}>
              {resumenArea}
            </p>
          </div>
          <div className="relative w-32 shrink-0" title="Escribe el área de una unidad para no usar la calculada.">
            <Input
              inputMode="decimal"
              aria-label="Área por unidad (m²)"
              value={areaManual}
              onChange={(e) => setAreaManual(e.target.value)}
              placeholder={calculo.areaManual ? "" : texto(calculo.areaUnidadM2) || "Área"}
              className="tnum h-8 pr-11 text-right"
            />
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs">
              m²/u
            </span>
          </div>
        </div>
        {calculo.aviso && (
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs" role="status">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {calculo.aviso}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="titulo-materiales">
        <div>
          <p id="titulo-materiales" className="text-sm font-medium">
            Materiales
          </p>
          <p className="text-muted-foreground text-xs">Lo que se usa de Odoo para fabricarlo. Suma al precio sugerido.</p>
        </div>

        {calculo.materiales.length > 0 ? (
          <ul className="bg-background divide-y rounded-lg border text-sm">
            {calculo.materiales.map((m) => (
              <li key={m.productoId} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {m.codigo && (
                      <span className="bg-muted/60 shrink-0 rounded border px-1.5 py-px font-mono text-xs">{m.codigo}</span>
                    )}
                    <span className="font-medium">
                      {m.esPlancha && calculo.formato
                        ? `Plancha ${calculo.formato.ancho}×${calculo.formato.alto}`
                        : m.esPlancha && plancha
                          ? `Plancha ${plancha.anchoCm}×${plancha.largoCm}`
                          : m.nombre}
                    </span>
                  </p>
                  {m.esPlancha && (
                    <p className="text-muted-foreground mt-0.5 text-xs break-words">
                      {m.nombre}{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setGrupoId(null);
                          setPestana("producto");
                        }}
                        className="text-primary cursor-pointer font-medium hover:underline"
                      >
                        Cambiar
                      </button>
                    </p>
                  )}
                </div>
                {m.esPlancha ? (
                  <span className="tnum w-20 shrink-0 text-right">
                    {m.cantidad} <span className="text-muted-foreground text-xs">{m.unidad ?? ""}</span>
                  </span>
                ) : (
                  <Input
                    inputMode="decimal"
                    aria-label={`Cantidad de ${m.nombre}`}
                    title={m.unidad ?? undefined}
                    value={String(m.cantidad)}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      if (!Number.isFinite(n) || n < 0) return;
                      setAccesorios((as) => as.map((a) => (a.productoId === m.productoId ? { ...a, cantidad: n } : a)));
                    }}
                    className="tnum h-8 w-20 shrink-0 text-right"
                  />
                )}
                <span className="tnum w-24 shrink-0 text-right">{money(m.cantidad * m.precio)}</span>
                {m.esPlancha ? (
                  <span className="size-7 shrink-0" />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Quitar ${m.nombre}`}
                    onClick={() => setAccesorios((as) => as.filter((a) => a.productoId !== m.productoId))}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
            <li className="bg-muted/30 flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 font-medium">Total material</span>
              <span className="tnum w-24 text-right font-medium">{money(calculo.costoMaterial)}</span>
              <span className="size-7 shrink-0" />
            </li>
          </ul>
        ) : (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs">
            {grupo ? "Escribe las medidas para estimar la plancha." : "Elige el material para estimar la plancha."}
          </p>
        )}
        {accesorios.some((a) => !(a.cantidad > 0)) && (
          <p className="text-muted-foreground text-xs">Un material con cantidad cero no se cuenta.</p>
        )}

        {buscandoAccesorio ? (
          <div className="flex flex-col gap-2 rounded-lg border p-2">
            <BuscadorProducto
              alAgregar={(p) => {
                agregarAccesorio(p);
                setBuscandoAccesorio(false);
              }}
              inputRef={enfocar}
              etiqueta="Buscar accesorio"
              enLinea
            />
            <Button type="button" variant="ghost" size="sm" className="self-end" onClick={() => setBuscandoAccesorio(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-primary hover:bg-primary/10 hover:text-primary self-start"
            onClick={() => setBuscandoAccesorio(true)}
          >
            <Plus aria-hidden />
            Agregar accesorio
            <span className="text-muted-foreground font-normal">· bisagras, imanes, tornillos…</span>
          </Button>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reservar}
            onChange={(e) => setReservar(e.target.checked)}
            className="accent-primary size-4"
          />
          Reservar este material en Odoo al confirmar el pedido
        </label>
      </section>
    </div>
  );

  /** Columna derecha, fija: el modelo 3D o, si no lo hay, por qué. */
  const sinModeloDetalle = "Las piezas y el material se estiman por la forma.";
  const modelo = !conDatos ? (
    <SinVistaPrevia titulo="Elige un producto para ver su modelo 3D." />
  ) : !producto ? (
    <SinVistaPrevia titulo="Los productos personalizados no tienen modelo 3D estándar." detalle={sinModeloDetalle} />
  ) : !producto.plantillaCad || !parametrosCad ? (
    <SinVistaPrevia titulo="Este producto todavía no cuenta con un modelo 3D estándar." detalle={sinModeloDetalle} />
  ) : modeloCad.tipo === "sin_acceso" ? (
    <SinVistaPrevia titulo="No tienes acceso al motor de diseños." detalle={sinModeloDetalle} />
  ) : modeloCad.tipo === "fallo" ? (
    <SinVistaPrevia titulo={modeloCad.mensaje} detalle={sinModeloDetalle} />
  ) : (
    <VisorModeloCad
      plantilla={producto.plantillaCad}
      parametros={parametrosCad}
      resultado={modeloCad.tipo === "listo" ? modeloCad.resultado : null}
      nombre={`${producto.codigo} ${producto.nombre}`}
      color={color || null}
      piezaActiva={piezaActiva}
      alCambiarPieza={setPiezaHover}
      alElegirPieza={elegirPieza}
      className="flex-1"
    />
  );

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent
        className="flex h-[94dvh] flex-col gap-0 p-0 sm:max-w-3xl lg:max-w-[min(96vw,1440px)]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            guardar();
          }
        }}
      >
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>{inicial ? "Editar producto terminado" : "Producto terminado"}</DialogTitle>
          <DialogDescription className="sr-only">
            Uno estándar del catálogo, con su medida, material y opciones; o uno personalizado, llenado a mano.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={pestanaVisible}
          onValueChange={(v) => setPestana(v as Pestana)}
          className="min-h-0 flex-1 gap-0 lg:grid lg:grid-cols-2"
        >
          {/* Izquierda: el formulario, las piezas y los materiales, cada uno en su pestaña. */}
          <div className={cn("min-h-0 flex-1 flex-col", pestanaVisible === "modelo" ? "hidden" : "flex")}>
            <div className="border-b px-5 pt-2">
              <TabsList variant="line" className="h-9">
                <TabsTrigger value="producto">Producto</TabsTrigger>
                <TabsTrigger value="modelo" className="lg:hidden">
                  Modelo
                </TabsTrigger>
                <TabsTrigger value="piezas" disabled={!conDatos}>
                  Piezas
                  {conDatos && totalPiezas > 0 && (
                    <span className="text-muted-foreground tnum font-normal">{totalPiezas}</span>
                  )}
                  {avisoPiezas && <Punto motivo={avisoPiezas} />}
                </TabsTrigger>
                <TabsTrigger value="materiales" disabled={!conDatos}>
                  Materiales
                  {avisoMateriales && <Punto motivo={avisoMateriales} />}
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <TabsContent value="producto" keepMounted className="data-[hidden]:hidden">
                {datos}
              </TabsContent>
              <TabsContent value="piezas" keepMounted className="data-[hidden]:hidden" ref={panelPiezas}>
                {piezas}
              </TabsContent>
              <TabsContent value="materiales" keepMounted className="data-[hidden]:hidden">
                {materiales}
              </TabsContent>
            </div>
          </div>

          {/* Derecha: el modelo, fijo. En pantalla angosta, solo con la pestaña Modelo. */}
          <div
            className={cn(
              "bg-muted/30 min-h-0 flex-1 flex-col p-4 lg:flex lg:border-l",
              pestanaVisible === "modelo" ? "flex" : "hidden",
            )}
          >
            {pestanaVisible === "modelo" && (
              <div className="mb-3 lg:hidden">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPestana("producto")}>
                  ← Volver al producto
                </Button>
              </div>
            )}
            {modelo}
          </div>
        </Tabs>

        {/* Cantidad, costo y precio: siempre a la vista. Cada celda, etiqueta arriba y valor de h-9 abajo. */}
        <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-3 rounded-b-xl border-t px-5 py-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <Campo label="Cantidad" requerido className="w-20">
              <Input
                inputMode="numeric"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))}
                className="tnum"
                disabled={!conDatos}
              />
            </Campo>
            <div className="flex flex-col gap-1.5" title="Material de una unidad: planchas y accesorios.">
              <span className="text-xs font-medium">Costo/u</span>
              <span className="tnum text-muted-foreground flex h-9 items-center text-sm" data-testid="costo-unidad">
                {money(costoUnidad)}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium">
                Sugerido
                {tipo && (
                  <Info className="text-muted-foreground size-3.5" aria-label={`Material × ${tipo.factor} + extras`}>
                    <title>{`Material × ${tipo.factor} + extras`}</title>
                  </Info>
                )}
              </span>
              <span className="tnum flex h-9 items-center text-sm" data-testid="precio-sugerido">
                {money(calculo.precioSugerido)}
              </span>
            </div>
            <Campo label="Precio unitario" className="w-32">
              <Input
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder={String(calculo.precioSugerido)}
                className={cn("tnum", !precioValido && "border-destructive")}
                disabled={!conDatos}
              />
            </Campo>
            <div className="flex flex-col gap-1.5" title="Lo que queda del precio unitario después del costo del material.">
              <span className="text-xs font-medium">Margen</span>
              <span
                className={cn(
                  "tnum flex h-9 items-center text-sm",
                  margen === null ? "text-muted-foreground" : margen < 0 ? "text-destructive font-medium" : "",
                )}
                data-testid="margen-terminado"
              >
                {margen === null ? "—" : `${Math.round(margen * 100)}%`}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Subtotal</span>
              <span className="tnum flex h-9 items-center text-base font-semibold" data-testid="subtotal-terminado">
                {money(precioValido ? Math.round(unidades * precioFinal * 100) / 100 : 0)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {falta && <p className="text-muted-foreground text-xs">{falta}</p>}
            <Button type="button" variant="outline" onClick={alCerrar}>
              Cancelar
            </Button>
            <Button type="button" onClick={guardar} disabled={!!falta}>
              {inicial ? "Guardar cambios" : "Agregar al pedido"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
