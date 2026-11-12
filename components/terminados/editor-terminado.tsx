"use client";

import { useMemo, useState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";
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
import { calcularTerminado, planchaDeReferencia, type Accesorio } from "@/lib/terminados/calcular";
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
  inicial,
  alGuardar,
  alCerrar,
}: {
  catalogo: CatalogoTerminados;
  planchas: GrupoPlancha[];
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
      }),
    [geometria, medidas, areaManual, unidades, plancha, accesorios, tipo, catalogo, opciones],
  );

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

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent
        className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            guardar();
          }
        }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{inicial ? "Editar producto terminado" : "Producto terminado"}</DialogTitle>
          <DialogDescription>
            Uno estándar del catálogo, con su medida, material y opciones; o uno personalizado, llenado a mano.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
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
                <ul className="max-h-56 overflow-y-auto rounded-lg border" aria-label="Productos del catálogo">
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

          {(producto || !estandar) && (
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
                    Material{" "}
                    {!estandar && <span className="text-muted-foreground font-normal">(opcional)</span>}
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

              {/* Material estimado */}
              <section className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-3" aria-label="Material estimado">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">Material estimado</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {calculo.areaUnidadM2
                        ? `${calculo.areaUnidadM2} m² por unidad${calculo.areaManual ? " (a mano)" : ` · ${GEOMETRIAS[geometria].nombre.toLowerCase()}`}; con ${catalogo.config.mermaPct}% de merma, ${calculo.areaTotalM2} m² en total.`
                        : "Sin área: escribe las medidas o el área de una unidad."}
                    </p>
                  </div>
                  <Campo label="Área por unidad (m²)" className="w-40">
                    <Input
                      inputMode="decimal"
                      value={areaManual}
                      onChange={(e) => setAreaManual(e.target.value)}
                      placeholder={calculo.areaManual ? "" : texto(calculo.areaUnidadM2) || "A mano"}
                      className="tnum"
                    />
                  </Campo>
                </div>

                {calculo.materiales.length > 0 && (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {calculo.materiales.map((m) => (
                      <li key={m.productoId} className="flex items-center gap-2">
                        {m.codigo && (
                          <span className="bg-background shrink-0 rounded border px-1.5 py-px font-mono text-xs">
                            {m.codigo}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {m.esPlancha && plancha ? `Plancha de ${plancha.anchoCm}×${plancha.largoCm}` : m.nombre}
                        </span>
                        {m.esPlancha ? (
                          <span className="tnum w-20 text-right">{m.cantidad}</span>
                        ) : (
                          <Input
                            inputMode="decimal"
                            aria-label={`Cantidad de ${m.nombre}`}
                            value={String(m.cantidad)}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(",", "."));
                              if (!Number.isFinite(n) || n < 0) return;
                              setAccesorios((as) => as.map((a) => (a.productoId === m.productoId ? { ...a, cantidad: n } : a)));
                            }}
                            className="tnum h-8 w-20 text-right"
                          />
                        )}
                        <span className="text-muted-foreground tnum w-24 text-right text-xs">
                          {money(m.cantidad * m.precio)}
                        </span>
                        {m.esPlancha ? (
                          <span className="size-7" />
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
                  </ul>
                )}
                {accesorios.some((a) => !(a.cantidad > 0)) && (
                  <p className="text-muted-foreground text-xs">Un material con cantidad cero no se cuenta.</p>
                )}

                <BuscadorProducto
                  alAgregar={agregarAccesorio}
                  etiqueta="Agregar accesorio o material"
                />

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

              {/* Cantidad y precio */}
              <div className="flex flex-wrap items-end gap-3">
                <Campo label="Cantidad" requerido className="w-28">
                  <Input
                    inputMode="numeric"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))}
                    className="tnum"
                  />
                </Campo>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium">Precio sugerido</span>
                  <span className="tnum flex h-9 items-center text-sm" data-testid="precio-sugerido">
                    {money(calculo.precioSugerido)}
                  </span>
                </div>
                <Campo
                  label="Precio unitario"
                  className="w-36"
                  ayuda={tipo ? `Material × ${tipo.factor} + extras` : undefined}
                >
                  <Input
                    inputMode="decimal"
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                    placeholder={String(calculo.precioSugerido)}
                    className={cn("tnum", !precioValido && "border-destructive")}
                  />
                </Campo>
                <div className="ml-auto flex flex-col items-end gap-1">
                  <span className="text-muted-foreground text-xs">Subtotal</span>
                  <span className="tnum flex h-9 items-center text-base font-semibold" data-testid="subtotal-terminado">
                    {money(precioValido ? Math.round(unidades * precioFinal * 100) / 100 : 0)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="border-t px-5 py-3">
          {falta && <p className="text-muted-foreground mr-auto self-center text-xs">{falta}</p>}
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="button" onClick={guardar} disabled={!!falta}>
            {inicial ? "Guardar cambios" : "Agregar al pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
