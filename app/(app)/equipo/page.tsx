import { exigirAdmin } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { EquipoTabla } from "@/components/equipo-tabla";

/**
 * Enlaza a cada trabajador del taller con su cuenta de la app.
 *
 * No es una `Vista`: `Vista` es la lista de filtros sobre pedidos que alimenta la
 * navegación y los contadores del shell, y esta pantalla no filtra pedidos.
 * Se entra por el menú de usuario, y solo Administración la ve.
 *
 * Existe porque el enlace inicial se hizo por nombre en una migración, y un
 * nombre no es una identidad: dos personas pueden llamarse igual y alguien puede
 * abrir su cuenta después. Sin esta pantalla, corregirlo sería escribir SQL.
 */
export default async function Page() {
  await exigirAdmin();

  const supabase = await clienteServidor();

  // Los inactivos también salen: aquí se administra el equipo, no se asignan
  // pedidos, y esconderlos deja el enlace de alguien invisible para siempre.
  const [trabajadores, usuarios] = await Promise.all([
    supabase.from("trabajadores").select("id, nombre, activo, usuario_id").order("nombre"),
    supabase
      .from("usuarios")
      .select("id, nombre, usuario, rol")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (trabajadores.error || usuarios.error) {
    throw new Error(
      `No se pudo leer el equipo: ${(trabajadores.error ?? usuarios.error)!.message}`,
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Equipo</h1>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Cada trabajador del taller recibe los avisos de sus pedidos en la cuenta que
          tenga enlazada aquí. Sin cuenta enlazada no recibe ninguno.
        </p>
      </header>

      <EquipoTabla trabajadores={trabajadores.data ?? []} usuarios={usuarios.data ?? []} />
    </div>
  );
}
