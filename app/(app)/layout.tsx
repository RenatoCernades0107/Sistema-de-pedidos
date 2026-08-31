import { AppShell } from "@/components/app-shell";
import { StoreProvider } from "@/lib/store";
import { cargarPedidos } from "@/lib/pedidos-servidor";
import { cargarTrabajadores, cargarUbigeo } from "@/lib/catalogos-servidor";
import { exigirSesion } from "@/lib/sesion";

/**
 * La puerta de la aplicación. El proxy ya desvió a quien no tiene sesión, pero
 * eso es una comprobación optimista: aquí se verifica de verdad contra Supabase
 * y se resuelve el rol, que es lo que decide qué se renderiza.
 *
 * Los pedidos se cargan una vez aquí y no en cada vista: las cuatro trabajan
 * sobre el mismo conjunto y solo cambian el filtro. Y como este layout se vuelve a
 * renderizar en la misma respuesta de cada Server Action que llama a `refresh()`,
 * es también el sitio por donde entra el resultado de cada escritura.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirSesion();
  const [pedidos, trabajadores, ubigeo] = await Promise.all([
    cargarPedidos(perfil.rol),
    cargarTrabajadores(),
    cargarUbigeo(),
  ]);

  return (
    <StoreProvider
      rol={perfil.rol}
      usuario={perfil.nombre}
      pedidos={pedidos}
      trabajadores={trabajadores}
      ubigeo={ubigeo}
    >
      <AppShell usuario={perfil.usuario}>{children}</AppShell>
    </StoreProvider>
  );
}
