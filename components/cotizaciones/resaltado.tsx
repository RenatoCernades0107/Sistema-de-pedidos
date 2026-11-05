import { resaltar, resaltarCodigo } from "@/lib/busqueda-inteligente";
import { cn } from "@/lib/utils";

/**
 * Pinta en negrita lo que coincide con lo escrito. Se compara sin tildes ni
 * mayúsculas, pero se muestra el texto tal cual: "José" no pierde su tilde.
 */
export function Resaltado({
  texto,
  consulta,
  codigo = false,
  className,
}: {
  texto: string;
  consulta: string;
  /** Un código se compara compactado: `ac0` marca `AC-0` en `AC-003`. */
  codigo?: boolean;
  className?: string;
}) {
  const tramos = codigo ? resaltarCodigo(texto, consulta) : resaltar(texto, consulta);
  return (
    <span className={className}>
      {tramos.map((t, i) =>
        t.marcado ? (
          <mark
            key={i}
            className={cn("text-foreground bg-primary/15 rounded-[2px] font-semibold")}
          >
            {t.texto}
          </mark>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </span>
  );
}
