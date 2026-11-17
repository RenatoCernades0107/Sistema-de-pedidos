import { exigirAdmin } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { TablaUsuarios } from "@/components/usuarios/tabla-usuarios";

/**
 * Las cuentas del sistema: crear, desactivar, registrar el correo de recuperación y
 * restablecer la contraseña. Solo Administración; se entra por el menú de usuario.
 *
 * No es la pantalla de `/equipo`, que enlaza a cada trabajador del taller con su
 * cuenta para los avisos: aquella decide quién recibe qué, esta decide quién entra.
 */
export default async function Page() {
  const perfil = await exigirAdmin();

  const supabase = await clienteServidor();
  // Las desactivadas también salen: aquí se reactivan.
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre, usuario, rol, activo, email_recuperacion")
    .order("activo", { ascending: false })
    .order("nombre");

  if (error) throw new Error(`No se pudieron leer las cuentas: ${error.message}`);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Quién puede entrar al sistema. Una cuenta desactivada no entra, pero sus pedidos y
          su historial se conservan. Si alguien olvida su contraseña, envíale el correo de
          recuperación; si no tiene correo registrado, ponle una contraseña temporal.
        </p>
      </header>

      <TablaUsuarios usuarios={data ?? []} yoId={perfil.id} />
    </div>
  );
}
