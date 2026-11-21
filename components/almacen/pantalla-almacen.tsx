"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, CircleAlert, FileDown, PackageMinus, PackagePlus, Plus, Warehouse } from "lucide-react";
import { TIPOS_ALMACEN } from "@/lib/almacenes";
import { materialesConPrecio } from "@/lib/lista-precios";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { Caso, Conteo, ConteoResumen } from "@/lib/casos";
import type { FaltanteGuardado } from "@/lib/faltantes";
import type { IngresoResumen, TransferenciaResumen } from "@/lib/inventario";
import type { Sobrante } from "@/lib/sobrantes";
import type { Inventario } from "@/lib/stock-servidor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PantallaSobrantes } from "@/components/sobrantes/pantalla-sobrantes";
import type { PedidoKardex, PermisosAlmacen } from "./comun";
import { DialogoAlmacenes } from "./dialogo-almacenes";
import { DialogoIngreso, ingresables } from "./dialogo-ingreso";
import { DialogoListaPrecios } from "./dialogo-lista-precios";
import { DialogoProducto } from "./dialogo-producto";
import { DialogoBaja, type BajaInicial } from "./dialogo-baja";
import { ListaCasos } from "./lista-casos";
import { ListaConteos, PantallaConteo } from "./conteos";
import { PanelKardex } from "./panel-kardex";
import { DialogoTransferencia, type TransferenciaInicial } from "./dialogo-transferencia";
import { ListaIngresos } from "./lista-ingresos";
import { ListaTransferencias } from "./lista-transferencias";
import { PorMover } from "./por-mover";
import { TablaAccesorios } from "./tabla-accesorios";
import { TablaPlanchas } from "./tabla-planchas";

export type Vista = "planchas" | "accesorios" | "sobrantes" | "mover" | "movimientos" | "casos" | "conteos";

/**
 * El almacén: el stock de planchas y accesorios en cada almacén, los sobrantes,
 * lo que hay que mover para los pedidos y los movimientos (transferencias e
 * ingresos). La pestaña va en la URL (`?vista=`) para que un enlace o una
 * recarga abran la misma.
 */
export function PantallaAlmacen({
  vista: inicial,
  inventario,
  sobrantes,
  preciosSobrantes,
  catalogo,
  ingresos,
  transferencias,
  faltantes,
  enCamino,
  casos,
  conteos,
  conteo,
  permisos,
  odooConectado,
}: {
  vista: Vista;
  inventario: Inventario;
  sobrantes: Sobrante[];
  preciosSobrantes: Record<string, number | null>;
  catalogo: GrupoPlancha[];
  ingresos: IngresoResumen[];
  transferencias: TransferenciaResumen[];
  faltantes: FaltanteGuardado[];
  /** Lo que viene en camino, por producto y almacén de destino. */
  enCamino: Record<number, Record<string, number>>;
  casos: Caso[];
  conteos: ConteoResumen[];
  /** El conteo abierto (`?conteo=`), para contar. */
  conteo: Conteo | null;
  permisos: PermisosAlmacen & { cerrarCasos: boolean };
  odooConectado: boolean;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const [vista, setVista] = useState<Vista>(inicial);
  const [dialogo, setDialogo] = useState<"ingreso" | "producto" | "almacenes" | "transferencia" | "baja" | "lista" | null>(null);
  const [baja, setBaja] = useState<BajaInicial | undefined>(undefined);
  const [kardex, setKardex] = useState<PedidoKardex | null>(null);
  const [transferencia, setTransferencia] = useState<TransferenciaInicial | undefined>(undefined);
  const { almacenes, planchas, accesorios, categorias, errorOdoo, hayFuera } = inventario;
  const activos = almacenes.filter((a) => a.activo);
  const productos = useMemo(() => ingresables(planchas, accesorios), [planchas, accesorios]);

  const cambiarVista = (v: Vista) => {
    setVista(v);
    router.replace(`${ruta}?vista=${v}`, { scroll: false });
  };

  const transferir = (inicial?: TransferenciaInicial) => {
    setTransferencia(inicial);
    setDialogo("transferencia");
  };
  const pendientes = faltantes.filter((f) => f.estado === "pendiente").length;
  const casosPendientes = casos.filter((c) => c.estado === "pendiente").length;
  const reportarBaja = (inicial?: BajaInicial) => {
    setBaja(inicial);
    setDialogo("baja");
  };
  const materiales = [...new Set(planchas.filter((p) => p.activo).map((p) => p.material))].sort();
  const enCaminoAqui = transferencias.filter((t) => t.estado === "enviada").length;

  const sobrantesEn = (id: string) =>
    sobrantes.filter((s) => s.almacenId === id && (s.estado === "disponible" || s.estado === "reservado")).length;

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Almacén</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Lo que hay de cada plancha y cada accesorio en cada almacén, según Odoo, y los sobrantes.
            {!permisos.gestionarStock && " Puedes verlo; lo cambian Administración y Logística."}
          </p>
        </div>
        {permisos.gestionarStock && (
          <div className="flex flex-wrap gap-2">
            {permisos.verPrecios && (
              <Button variant="outline" className="gap-1.5" onClick={() => setDialogo("lista")} disabled={!odooConectado}>
                <FileDown className="size-4" />
                Lista de precios
              </Button>
            )}
            <Button variant="outline" className="gap-1.5" onClick={() => setDialogo("almacenes")}>
              <Warehouse className="size-4" />
              Almacenes
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setDialogo("producto")} disabled={!odooConectado}>
              <Plus className="size-4" />
              Nuevo producto
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => reportarBaja()} disabled={!odooConectado}>
              <PackageMinus className="size-4" />
              Reportar baja
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => transferir()} disabled={!odooConectado}>
              <ArrowLeftRight className="size-4" />
              Transferir
            </Button>
            <Button className="gap-1.5" onClick={() => setDialogo("ingreso")} disabled={!odooConectado}>
              <PackagePlus className="size-4" />
              Ingresar stock
            </Button>
          </div>
        )}
      </header>

      <ul className="mb-4 flex flex-wrap gap-2" aria-label="Almacenes">
        {activos.map((a) => (
          <li key={a.id} className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <Warehouse className="text-muted-foreground size-3.5" />
            <span className="font-medium">{a.nombre}</span>
            <span className="text-muted-foreground text-xs">
              {TIPOS_ALMACEN[a.tipo]} · {a.codigo} · {sobrantesEn(a.id)} {sobrantesEn(a.id) === 1 ? "sobrante" : "sobrantes"}
            </span>
            {!a.odooWarehouseId && (
              <span className="text-st-observado text-xs" title={a.errorSincronizacion ?? undefined}>
                · no está en Odoo
              </span>
            )}
          </li>
        ))}
      </ul>

      {(!odooConectado || errorOdoo) && (
        <p className="border-st-observado/25 bg-st-observado-soft mb-4 flex gap-2 rounded-xl border p-3 text-sm">
          <CircleAlert className="text-st-observado mt-0.5 size-4 shrink-0" />
          <span>
            {!odooConectado
              ? "Falta conectar Odoo: el catálogo se ve, pero sin stock ni precios, y no se puede ingresar stock."
              : `Odoo no respondió del todo: ${errorOdoo}`}
          </span>
        </p>
      )}
      {hayFuera && (
        <p className="bg-muted/40 mb-4 flex gap-2 rounded-xl border p-3 text-sm">
          <CircleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span>
            Hay stock en Odoo fuera de estos almacenes (columna <span className="font-medium">Anterior</span>: otra
            ubicación de Odoo que la app no maneja). Cuéntalo y regístralo con un ajuste en el almacén donde está de
            verdad.
          </span>
        </p>
      )}

      <Tabs value={vista} onValueChange={(v) => cambiarVista(v as Vista)}>
        <TabsList className="mb-4">
          <TabsTrigger value="planchas">Planchas</TabsTrigger>
          <TabsTrigger value="accesorios">Accesorios</TabsTrigger>
          <TabsTrigger value="sobrantes">Sobrantes</TabsTrigger>
          {permisos.gestionarStock && (
            <TabsTrigger value="mover">
              Por mover
              {pendientes > 0 && (
                <span className="bg-st-observado ml-1.5 rounded-full px-1.5 text-[0.68rem] font-semibold text-white">{pendientes}</span>
              )}
            </TabsTrigger>
          )}
          {permisos.gestionarStock && (
            <TabsTrigger value="casos">
              Casos
              {casosPendientes > 0 && (
                <span className="bg-st-observado ml-1.5 rounded-full px-1.5 text-[0.68rem] font-semibold text-white">{casosPendientes}</span>
              )}
            </TabsTrigger>
          )}
          {permisos.gestionarStock && <TabsTrigger value="conteos">Conteos</TabsTrigger>}
          <TabsTrigger value="movimientos">
            Movimientos
            {enCaminoAqui > 0 && (
              <span className="bg-st-en_transito ml-1.5 rounded-full px-1.5 text-[0.68rem] font-semibold text-white">{enCaminoAqui}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="planchas">
          <TablaPlanchas
            planchas={planchas}
            almacenes={almacenes}
            permisos={permisos}
            conFuera={hayFuera}
            enCamino={enCamino}
            alVerKardex={odooConectado ? setKardex : undefined}
          />
        </TabsContent>
        <TabsContent value="accesorios">
          <TablaAccesorios
            accesorios={accesorios}
            categorias={categorias}
            almacenes={almacenes}
            permisos={permisos}
            conFuera={hayFuera}
            enCamino={enCamino}
            alVerKardex={odooConectado ? setKardex : undefined}
          />
        </TabsContent>
        <TabsContent value="sobrantes">
          <PantallaSobrantes
            sobrantes={sobrantes}
            catalogo={catalogo}
            almacenes={almacenes}
            precios={preciosSobrantes}
            permisos={permisos}
            odooConectado={odooConectado}
            alTransferir={(s) =>
              transferir({ desdeId: s.almacenId, haciaId: null, lineas: [], sobrantes: [s.codigo], faltanteIds: [], pedidoId: null })
            }
            alReportarBaja={(s) => reportarBaja({ almacenId: s.almacenId, sobrante: s.codigo })}
            alVerHistoria={(s) =>
              setKardex({ productoId: null, sobrante: s.codigo, codigo: s.codigo, titulo: `${s.material} · ${s.largo}×${s.ancho} cm` })
            }
          />
        </TabsContent>
        {permisos.gestionarStock && (
          <TabsContent value="mover">
            <PorMover faltantes={faltantes} almacenes={almacenes} productos={productos} alTransferir={transferir} />
          </TabsContent>
        )}
        {permisos.gestionarStock && (
          <TabsContent value="casos">
            <ListaCasos casos={casos} cierra={permisos.cerrarCasos} />
          </TabsContent>
        )}
        {permisos.gestionarStock && (
          <TabsContent value="conteos">
            {conteo ? (
              <PantallaConteo key={conteo.id} conteo={conteo} productos={productos} />
            ) : (
              <ListaConteos conteos={conteos} almacenes={almacenes} materiales={materiales} categorias={categorias} />
            )}
          </TabsContent>
        )}
        <TabsContent value="movimientos">
          <section className="flex flex-col gap-2" aria-labelledby="titulo-transferencias">
            <h2 id="titulo-transferencias" className="text-sm font-semibold">
              Transferencias
            </h2>
            <ListaTransferencias transferencias={transferencias} gestiona={permisos.gestionarStock} />
          </section>
          {permisos.gestionarStock && (
            <section className="mt-6 flex flex-col gap-2" aria-labelledby="titulo-ingresos">
              <h2 id="titulo-ingresos" className="text-sm font-semibold">
                Ingresos
              </h2>
              <ListaIngresos ingresos={ingresos} />
            </section>
          )}
        </TabsContent>
      </Tabs>

      {dialogo === "ingreso" && (
        <DialogoIngreso almacenes={almacenes} productos={productos} alCerrar={() => setDialogo(null)} />
      )}
      {dialogo === "producto" && (
        <DialogoProducto
          planchas={planchas}
          categorias={categorias}
          ponePrecio={permisos.editarPrecios}
          alCerrar={() => setDialogo(null)}
        />
      )}
      {dialogo === "lista" && (
        <DialogoListaPrecios
          materiales={materialesConPrecio(planchas)}
          categorias={categorias.filter((c) => accesorios.some((a) => a.categoriaId === c.id && a.activo && (a.precio ?? 0) > 0))}
          alCerrar={() => setDialogo(null)}
        />
      )}
      {dialogo === "almacenes" && <DialogoAlmacenes almacenes={almacenes} alCerrar={() => setDialogo(null)} />}
      {dialogo === "baja" && (
        <DialogoBaja
          almacenes={almacenes}
          productos={productos}
          sobrantes={sobrantes}
          inicial={baja}
          cierraCasos={permisos.cerrarCasos}
          alCerrar={() => setDialogo(null)}
        />
      )}
      {kardex && <PanelKardex pedido={kardex} almacenes={almacenes} alCerrar={() => setKardex(null)} />}
      {dialogo === "transferencia" && (
        <DialogoTransferencia
          almacenes={almacenes}
          productos={productos}
          sobrantes={sobrantes}
          inicial={transferencia}
          alCerrar={() => setDialogo(null)}
        />
      )}
    </div>
  );
}
