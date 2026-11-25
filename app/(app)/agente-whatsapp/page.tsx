import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { exigirAgenteWhatsapp } from "@/lib/sesion";
import { cargarConfigEmpresa } from "@/lib/empresa-servidor";
import { cargarCuentasBancarias } from "@/lib/cuentas-bancarias-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { AGENTE_NO_CONFIGURADO, agenteConfigurado } from "@/lib/agente-whatsapp/config";
import { cargarDocumentos } from "@/lib/agente-whatsapp/conocimiento-servidor";
import { cargarAjustesAgente } from "@/lib/agente-whatsapp/contexto-servidor";
import { cuentasParaAgente } from "@/lib/agente-whatsapp/cuentas";
import { cargarPruebas } from "@/lib/agente-whatsapp/pruebas-servidor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProbarAgente } from "@/components/agente-whatsapp/probar-agente";
import { BaseConocimiento } from "@/components/agente-whatsapp/base-conocimiento";
import { AjustesAgenteForm } from "@/components/agente-whatsapp/ajustes-agente";

const PESTANAS = ["probar", "conocimiento", "ajustes"] as const;

/**
 * El agente de ventas de WhatsApp, en su área de pruebas: aquí se prueba como
 * si fuera un cliente, se le dan los catálogos, fichas y fotos que consulta, y
 * se ajusta cómo responde. Todavía no está conectado a un número: nada de lo
 * que pasa aquí llega a WhatsApp.
 */
export default async function Page({ searchParams }: PageProps<"/agente-whatsapp">) {
  await exigirAgenteWhatsapp();
  const { tab } = await searchParams;
  const inicial = PESTANAS.find((p) => p === tab) ?? "probar";
  const [documentos, ajustes, pruebas, empresa, cuentas] = await Promise.all([
    cargarDocumentos(),
    cargarAjustesAgente(),
    cargarPruebas(),
    cargarConfigEmpresa(),
    cargarCuentasBancarias(),
  ]);

  const configurado = agenteConfigurado();
  const avisos: { texto: string; enlace?: { href: string; texto: string } }[] = [
    ...(configurado ? [] : [{ texto: AGENTE_NO_CONFIGURADO }]),
    ...(odooConfigurado() ? [] : [{ texto: "Odoo no está configurado: el agente no puede dar precios." }]),
    ...(empresa.direccion
      ? []
      : [
          {
            texto: "Falta la dirección de la empresa: el agente no sabrá decir dónde están.",
            enlace: { href: "/configuracion?tab=empresa", texto: "Completar en Configuración" },
          },
        ]),
    ...(cuentasParaAgente(cuentas).length > 0
      ? []
      : [
          {
            texto: "No hay cuentas bancarias vigentes marcadas para el PDF: el agente no tendrá formas de pago que dar.",
            enlace: { href: "/configuracion?tab=cuentas", texto: "Ver cuentas" },
          },
        ]),
  ];

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Agente de WhatsApp</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          El área de pruebas del agente de ventas: escríbele como un cliente, dale catálogos y fotos, y ajusta cómo
          responde. Todavía no está conectado a un número; nada de lo que pasa aquí llega a WhatsApp.
        </p>
      </header>

      {avisos.length > 0 && (
        <ul className="mb-4 flex max-w-5xl flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          {avisos.map((a) => (
            <li key={a.texto} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                {a.texto}
                {a.enlace && (
                  <>
                    {" "}
                    <Link href={a.enlace.href} className="text-primary underline-offset-4 hover:underline">
                      {a.enlace.texto}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Tabs defaultValue={inicial} className="gap-4">
        <TabsList>
          <TabsTrigger value="probar" className="px-3">
            Probar
          </TabsTrigger>
          <TabsTrigger value="conocimiento" className="px-3">
            Conocimiento
            <span className="text-muted-foreground tnum text-xs">{documentos.length}</span>
          </TabsTrigger>
          <TabsTrigger value="ajustes" className="px-3">
            Ajustes
          </TabsTrigger>
        </TabsList>
        <TabsContent value="probar">
          <ProbarAgente pruebas={pruebas} anuncios={ajustes.anuncios} configurado={configurado} />
        </TabsContent>
        <TabsContent value="conocimiento">
          <BaseConocimiento documentos={documentos} />
        </TabsContent>
        <TabsContent value="ajustes">
          <AjustesAgenteForm ajustes={ajustes} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
