import { exigirAdmin } from "@/lib/sesion";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { cargarCatalogoTerminados } from "@/lib/terminados-servidor";
import { CatalogoTerminados } from "@/components/configuracion/catalogo-terminados";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogoPlanchas } from "@/components/configuracion/catalogo-planchas";
import { FormConfigCortes } from "@/components/configuracion/config-cortes";

/**
 * Lo que Administración ajusta sin tocar código: cómo se calcula y se cobra un
 * corte, y qué planchas existen.
 *
 * No es un `Alcance` de `/pedidos`: aquí no se filtran pedidos. Se entra por el
 * menú de herramientas, y solo Administración la ve.
 */
export default async function Page() {
  await exigirAdmin();
  const [config, grupos, terminados] = await Promise.all([
    cargarConfigCortes(),
    cargarCatalogoPlanchas(),
    cargarCatalogoTerminados(),
  ]);
  const formatos = grupos.reduce((n, g) => n + g.formatos.length, 0);

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Cómo se calcula un corte, con qué planchas, y qué productos terminados se fabrican. Lo que cambies vale para las cotizaciones y
          pedidos que se hagan desde ahora; los ya registrados conservan su cálculo.
        </p>
      </header>

      <Tabs defaultValue="cortes" className="max-w-5xl gap-4">
        <TabsList>
          <TabsTrigger value="cortes" className="px-3">
            Precios de corte
          </TabsTrigger>
          <TabsTrigger value="planchas" className="px-3">
            Planchas
            <span className="text-muted-foreground tnum text-xs">{formatos}</span>
          </TabsTrigger>
          <TabsTrigger value="terminados" className="px-3">
            Productos terminados
            <span className="text-muted-foreground tnum text-xs">{terminados.productos.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cortes">
          <FormConfigCortes config={config} />
        </TabsContent>
        <TabsContent value="terminados">
          <CatalogoTerminados catalogo={terminados} />
        </TabsContent>
        <TabsContent value="planchas">
          <CatalogoPlanchas grupos={grupos} odooConectado={odooConfigurado()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
