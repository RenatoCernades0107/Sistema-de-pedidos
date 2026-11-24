"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Package, Scissors } from "lucide-react";
import { toast } from "sonner";
import { crearCotizacion } from "@/app/(app)/cotizaciones/acciones";
import { CANALES, type Canal } from "@/lib/cotizaciones";
import { money } from "@/lib/formato";
import {
  actualizarLinea,
  agregarProducto,
  cambiarCantidad,
  esCorte,
  esTerminado,
  ponerCorte,
  ponerTerminado,
  problemaDeLineas,
  quitarLinea,
  totalReferencial,
  type Linea,
  type LineaTerminado,
} from "@/lib/lineas-cotizacion";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { EditorCorte } from "@/components/cortes/editor-corte";
import type { DatosDiseno } from "@/components/terminados/disenador-terminado";
import { useTerminadosCad } from "@/components/terminados/use-terminados-cad";
import type { CatalogoTerminados } from "@/lib/terminados/catalogo";
import type { ClienteOdoo, ContactoOdoo, ProductoOdoo } from "@/lib/odoo/tipos";
import { Button } from "@/components/ui/button";
import { BarraEnvio } from "@/components/ui/barra-envio";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { Campo, Opciones } from "@/components/ui/campo";
import { Seccion } from "@/components/ui/seccion";
import { useBorrador } from "@/lib/use-borrador";
import { resumenDe, type BorradorAbierto, type DatosBorradorCotizacion } from "@/lib/borradores";
import { IndicadorBorrador } from "@/components/borradores/lista-borradores";
import { Textarea } from "@/components/ui/textarea";
import { BuscadorCliente } from "./buscador-cliente";
import { BarraAgregar } from "./barra-agregar";
import { LineasCotizacion } from "./lineas-cotizacion";

/**
 * Registrar una cotización. Pensado para el mostrador: teclado primero y que
 * nada obligue a soltarlo.
 *
 *   cliente → Enter → código del producto → Enter → cantidad → Enter →
 *   siguiente producto → … → Ctrl/⌘ + Enter
 *
 * Al crear, se guarda en la base y se crea en Odoo en el mismo paso. Si Odoo
 * falla, lo cotizado queda guardado y el detalle ofrece reintentar.
 */
export function FormCotizacion({
  catalogo,
  config,
  terminados,
  diseno,
  lineaInicial = null,
  borrador = null,
}: {
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  /** El catálogo de productos terminados. */
  terminados: CatalogoTerminados;
  /** Para diseñar los productos terminados con el motor CAD, como en el nuevo pedido. */
  diseno: DatosDiseno;
  /**
   * Un diseño CAD con el que arrancar (desde «Agregar a cotización» en
   * `/disenos`): entra como línea, y el lápiz vuelve a abrir el diseño.
   */
  lineaInicial?: { linea: Omit<LineaTerminado, "tipo" | "clave">; disenoId: string } | null;
  /** El borrador que se retoma: el formulario arranca tal como quedó. */
  borrador?: BorradorAbierto<DatosBorradorCotizacion> | null;
}) {
  const router = useRouter();
  const previo = borrador?.datos ?? null;
  const [canal, setCanal] = useState<Canal>(previo?.canal ?? "tienda");
  const [cliente, setCliente] = useState<ClienteOdoo | null>(previo?.cliente ?? null);
  const [contacto, setContacto] = useState<ContactoOdoo | null>(previo?.contacto ?? null);
  const [arranque] = useState(() =>
    lineaInicial ? ponerTerminado(previo?.lineas ?? [], lineaInicial.linea) : null,
  );
  const [lineas, setLineas] = useState<Linea[]>(arranque?.lineas ?? previo?.lineas ?? []);
  /** El editor de corte: cerrado, abierto para uno nuevo, o editando el de esa clave. */
  const [corte, setCorte] = useState<{ clave: string | null } | null>(null);
  const [notas, setNotas] = useState(previo?.notas ?? "");
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  /** Ya se intentó crear: desde ahí, lo que falta se dice junto a su sección. */
  const [intentado, setIntentado] = useState(false);
  /** Creada: ya no hay nada que perder al salir. */
  const [creada, setCreada] = useState(false);

  const buscadorProducto = useRef<HTMLInputElement>(null);
  const buscadorCliente = useRef<HTMLInputElement>(null);
  const cantidades = useRef(new Map<string, HTMLInputElement>());
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  const marcar = (clave: string) => {
    setResaltada(clave);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setResaltada(null), 1200);
  };

  const terminadosCad = useTerminadosCad({
    lineas,
    alPoner: (siguientes, clave) => {
      setLineas(siguientes);
      marcar(clave);
      // De vuelta al buscador: lo siguiente es otro producto o crear.
      requestAnimationFrame(() => buscadorProducto.current?.focus());
    },
    catalogo,
    config,
    terminados,
    diseno,
    cliente: cliente?.nombre,
    enlazadas: {
      ...previo?.disenosDeLinea,
      ...(arranque && lineaInicial ? { [arranque.clave]: lineaInicial.disenoId } : {}),
    },
  });

  const elegirCliente = (c: ClienteOdoo | null, ct: ContactoOdoo | null = null) => {
    flushSync(() => {
      setCliente(c);
      // El contacto es de una empresa: otro cliente, otro contacto.
      setContacto(ct);
    });
    // Con el cliente elegido, lo siguiente son los productos.
    if (c) buscadorProducto.current?.focus();
  };

  const agregar = (p: ProductoOdoo) => {
    // Fuera del actualizador a propósito: genera la clave de la línea, y un
    // actualizador tiene que ser puro (el modo estricto lo corre dos veces).
    // Si ya estaba, suma uno a su línea: el resaltado y el foco en su cantidad
    // lo dicen sin un aviso que tape la barra de crear.
    const { lineas: siguientes, clave } = agregarProducto(lineas, p);
    flushSync(() => setLineas(siguientes));
    marcar(clave);
    // A la cantidad de esa línea, con el número seleccionado: se escribe encima.
    const input = cantidades.current.get(clave);
    input?.focus();
    input?.select();
  };

  const refCantidad = useCallback((clave: string, el: HTMLInputElement | null) => {
    if (el) cantidades.current.set(clave, el);
    else cantidades.current.delete(clave);
  }, []);

  const total = totalReferencial(lineas);
  const problemaLineas = problemaDeLineas(lineas);
  const problema = !cliente ? "Elige el cliente." : problemaLineas;

  // Mientras se llena, todo queda guardado como borrador (solo lo ve quien lo crea).
  const autoguardado = useBorrador({
    tipo: "cotizacion",
    idInicial: borrador?.id ?? null,
    datos: {
      version: 1,
      canal,
      cliente,
      contacto,
      lineas,
      notas,
      // Solo las de líneas que siguen en la cotización.
      disenosDeLinea: Object.fromEntries(
        Object.entries(terminadosCad.disenosDeLinea).filter(([clave]) => lineas.some((l) => l.clave === clave)),
      ),
    },
    resumen: resumenDe(cliente, lineas),
    conContenido: !!cliente || lineas.length > 0 || notas.trim() !== "",
    activo: !creada,
  });

  const crear = () => {
    if (pendiente) return;
    setIntentado(true);
    if (problema || !cliente) {
      toast.error(problema ?? "Falta el cliente.");
      if (!cliente) buscadorCliente.current?.focus();
      else if (lineas.length === 0) buscadorProducto.current?.focus();
      return;
    }

    iniciar(async () => {
      const r = await crearCotizacion({
        canal,
        clienteId: cliente.id,
        contactoId: cliente.esEmpresa ? (contacto?.id ?? null) : null,
        lineas: lineas.map(lineaParaEnviar),
        notas: notas.trim() || null,
      });

      if (!r.ok) {
        toast.error("No se pudo crear la cotización", { description: r.error });
        return;
      }
      if (r.enOdoo) {
        toast.success(`Cotización ${r.orderName} creada en Odoo`);
      } else {
        toast.warning("Se guardó, pero Odoo no la aceptó", {
          description: r.errorOdoo ?? undefined,
        });
      }
      setCreada(true);
      // Ya es una cotización: el borrador sobra.
      await autoguardado.terminar();
      router.push(`/cotizaciones/${r.id}`);
    });
  };

  return (
    <div
      className="px-4 py-5 md:px-6 md:py-6"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          crear();
        }
      }}
    >
      <CabeceraFormulario
        volverA="/cotizaciones"
        volverTexto="Cotizaciones"
        titulo="Nueva cotización"
        subtitulo="Se crea también en Odoo."
        lateral={
          <div className="flex flex-col items-end gap-0.5">
          <IndicadorBorrador estado={autoguardado.estado} />
          <p className="text-muted-foreground hidden text-xs md:block">
            Crear sin soltar el teclado:{" "}
            <kbd className="kbd">Ctrl</kbd>{" "}
            +{" "}
            <kbd className="kbd">Enter</kbd>
          </p>
          </div>
        }
      />

      <div className="flex max-w-3xl flex-col gap-4">
        <Seccion
          n={1}
          titulo="Cliente y productos"
          completa={!!cliente && lineas.length > 0 && !problemaLineas}
          nota={lineas.length ? `${lineas.length} ${lineas.length === 1 ? "línea" : "líneas"}` : undefined}
        >
          <Campo grupo label="Canal" ayuda="De dónde llegó el pedido de cotización.">
            <Opciones
              valores={[canal]}
              onToggle={(v) => setCanal(v as Canal)}
              opciones={Object.entries(CANALES).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>
          <BuscadorCliente
            cliente={cliente}
            alElegir={elegirCliente}
            contacto={contacto}
            alElegirContacto={setContacto}
            inputRef={buscadorCliente}
            autoFocus
          />
          {intentado && !cliente && (
            <p role="alert" className="text-destructive -mt-2 text-sm">
              Elige el cliente.
            </p>
          )}
          <BarraAgregar
            alAgregar={agregar}
            inputRef={buscadorProducto}
            catalogo={catalogo}
            acciones={
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 gap-1.5"
                  onClick={() => setCorte({ clave: null })}
                  disabled={catalogo.length === 0}
                  title={catalogo.length === 0 ? "No hay planchas en el catálogo" : undefined}
                >
                  <Scissors />
                  Corte a medida
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 gap-1.5"
                  onClick={() => void terminadosCad.nuevo()}
                  disabled={terminadosCad.abriendo}
                >
                  {terminadosCad.abriendo ? <Loader2 className="animate-spin" /> : <Package />}
                  Producto terminado
                </Button>
              </>
            }
          />
          <LineasCotizacion
            lineas={lineas}
            resaltada={resaltada}
            refCantidad={refCantidad}
            alCambiar={(clave, cambios) => setLineas((ls) => actualizarLinea(ls, clave, cambios))}
            alCambiarCantidad={(clave, delta) => setLineas((ls) => cambiarCantidad(ls, clave, delta))}
            alQuitar={(clave) => {
              setLineas((ls) => quitarLinea(ls, clave));
              buscadorProducto.current?.focus();
            }}
            alEditarCorte={(clave) => setCorte({ clave })}
            alEditarTerminado={(clave) => void terminadosCad.editar(clave)}
            alTerminar={() => buscadorProducto.current?.focus()}
          />
          {intentado && problemaLineas && (
            <p role="alert" className="text-destructive text-sm">
              {problemaLineas}
            </p>
          )}
        </Seccion>

        <Seccion n={2} titulo="Notas" nota="Opcional">
          <Campo label="Notas internas" ayuda="Quedan en el sistema; no salen en la cotización de Odoo.">
            <Textarea
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={2000}
              placeholder="Ej. pasa a recoger el viernes; quiere el corte en láser"
            />
          </Campo>
        </Seccion>
      </div>

      {corte && (
        <EditorCorte
          catalogo={catalogo}
          config={config}
          inicial={lineas.filter(esCorte).find((l) => l.clave === corte.clave) ?? null}
          alCerrar={() => setCorte(null)}
          alGuardar={(nuevo) => {
            const { lineas: siguientes, clave } = ponerCorte(lineas, nuevo);
            setLineas(siguientes);
            setCorte(null);
            marcar(clave);
            // De vuelta al buscador: lo siguiente es otro producto o crear.
            requestAnimationFrame(() => buscadorProducto.current?.focus());
          }}
        />
      )}

      {terminadosCad.editores}

      <BarraEnvio
        resumen={[
          { etiqueta: lineas.length === 1 ? "Producto" : "Productos", valor: String(lineas.length) },
          { etiqueta: "Total", valor: money(total) },
        ]}
        problema={problema}
        texto="Crear cotización"
        textoPendiente="Creando en Odoo…"
        pendiente={pendiente}
        onClick={crear}
      />
    </div>
  );
}

/**
 * Una línea como viaja a `crearCotizacion`. De un corte van el material, las
 * piezas y el formato; el precio lo vuelve a calcular el servidor, y el total
 * que se mostró va solo para que avise si ya no coincide.
 */
export function lineaParaEnviar(l: Linea) {
  if (esCorte(l)) {
    return {
      tipo: "corte" as const,
      grupoId: l.grupoId,
      modalidad: l.modalidad,
      lugar: l.lugar,
      piezas: l.piezas,
      formatoCodigo: l.calculo.formato.codigo,
      eleccion: l.eleccion ?? null,
      totalMostrado: l.calculo.total,
    };
  }
  if (esTerminado(l)) {
    const m = l.medidas;
    return {
      tipo: "terminado" as const,
      productoCodigo: l.productoCodigo,
      nombre: l.productoCodigo ? null : l.nombre.trim() || null,
      tipoCodigo: l.tipoCodigo,
      medidas: {
        m1: m.m1 || null,
        m2: m.m2 || null,
        m3: m.m3 || null,
        diametro: m.diametro || null,
        altura: m.altura || null,
        letras: m.letras || null,
      },
      grupoId: l.grupoId,
      opciones: l.opciones,
      eleccion: l.eleccion ?? null,
      texto: l.texto.trim() || null,
      notas: l.notas.trim() || null,
      areaM2: l.areaManualM2,
      accesorios: l.accesorios.map((a) => ({ productoId: a.productoId, cantidad: Number(a.cantidad) })),
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precioUnitario),
      reservar: l.reservar,
      disenoVersionId: l.disenoVersionId ?? null,
    };
  }
  return {
    productoId: l.productoId,
    cantidad: Number(l.cantidad),
    precioUnitario: Number(l.precioUnitario),
    descripcion: l.descripcion.trim() || null,
  };
}
