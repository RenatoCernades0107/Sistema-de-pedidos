import { HORAS_BORRADOR } from "@/lib/borradores";

/** Se abrió `?borrador=` de uno que ya no está: venció, se eliminó o no es tuyo. */
export function AvisoBorradorVencido() {
  return (
    <p role="alert" className="text-muted-foreground px-4 pt-5 text-sm md:px-6" data-testid="borrador-vencido">
      Ese borrador ya no existe: se eliminó o pasaron {HORAS_BORRADOR} h sin abrirlo. Empiezas con el formulario vacío.
    </p>
  );
}
