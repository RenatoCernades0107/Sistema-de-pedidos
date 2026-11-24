import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { exigirCotizaciones } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { cargarCatalogoTerminados } from "@/lib/terminados-servidor";
import { calentarCatalogos } from "@/lib/odoo/catalogos";
import { contactosDeEmpresa, leerCliente } from "@/lib/odoo/clientes";
import { odooConfigurado } from "@/lib/odoo/rpc";
import type { ClienteOdoo, ContactoOdoo } from "@/lib/odoo/tipos";
import { cargarCotizacion } from "@/lib/cotizaciones-servidor";
import { esEditable, referenciaDe, type LineaGuardada } from "@/lib/cotizaciones";
import type { LineaCotizacion } from "@/lib/lineas-cotizacion";
import { catalogoParaDiseno, plantillasDelMotor } from "@/lib/cad/pagina-servidor";
import { FormCotizacion } from "@/components/cotizaciones/form-cotizacion";
import { AvisoOdoo } from "@/components/cotizaciones/aviso-odoo";

/**
 * Editar una cotización. Solo mientras es borrador y no tiene pedido: una
 * enviada se queda como se le ofreció al cliente, y para cambiarla se hace una
 * versión nueva desde su detalle.
 */
export default async function Page({ params }: PageProps<"/cotizaciones/[id]/editar">) {
  const perfil = await exigirCotizaciones();
  const { id } = await params;
  const c = await cargarCotizacion(id);
  if (!c) notFound();
  if (!esEditable(c)) redirect(`/cotizaciones/${c.id}`);

  if (!odooConfigurado()) {
    return (
      <div className="px-4 py-5 md:px-6 md:py-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Editar {referenciaDe(c)}</h1>
        <AvisoOdoo className="max-w-3xl" />
      </div>
    );
  }

  after(() => calentarCatalogos());

  const [catalogo, config, terminados, { plantillas, aviso }, planchas, clienteOdoo, contactos] = await Promise.all([
    cargarCatalogoPlanchas(true),
    cargarConfigCortes(),
    cargarCatalogoTerminados(true),
    plantillasDelMotor(),
    catalogoParaDiseno(ROLES[perfil.rol].verPrecios),
    leerCliente(c.cliente.id).catch(() => null),
    c.cliente.contacto ? contactosDeEmpresa(c.cliente.id).catch(() => []) : Promise.resolve([] as ContactoOdoo[]),
  ]);

  // Si Odoo ya no devuelve al cliente, se edita con la foto que guardó la cotización.
  const cliente: ClienteOdoo = clienteOdoo ?? {
    id: c.cliente.id,
    nombre: c.cliente.nombre,
    documento: c.cliente.documento,
    telefono: c.cliente.telefono,
    email: null,
    ciudad: null,
    esEmpresa: !!c.cliente.contacto,
    empresa: null,
  };
  const contacto = c.cliente.contacto ? (contactos.find((x) => x.id === c.cliente.contacto!.id) ?? null) : null;

  const esProducto = (l: LineaGuardada) => (l.tipo ?? (l.corte ? "corte" : l.terminado ? "terminado" : "producto")) === "producto";
  const lineas: LineaCotizacion[] = c.lineas.filter(esProducto).map((l) => ({
    clave: `p${l.posicion}`,
    productoId: l.productoId,
    nombre: l.nombre,
    codigo: l.codigo,
    unidad: null,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    descripcion: l.descripcion ?? "",
  }));

  return (
    <FormCotizacion
      catalogo={catalogo}
      config={config}
      terminados={terminados}
      diseno={{
        plantillas,
        avisoMotor: aviso,
        corte: { kerfMm: planchas.kerfMm, margenMm: planchas.margenMm, politica: planchas.politica },
        costos: planchas.costos,
      }}
      key={c.id}
      edicion={{
        id: c.id,
        referencia: referenciaDe(c),
        version: c.version,
        canal: c.canal,
        cliente,
        contacto,
        lineas,
        conservadas: c.lineas.filter((l) => !esProducto(l)),
        notas: c.notas ?? "",
      }}
    />
  );
}
