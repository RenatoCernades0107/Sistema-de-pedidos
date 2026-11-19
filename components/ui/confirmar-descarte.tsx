"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Cerrar un editor (corte, producto terminado) sin perder lo escrito por un
 * clic de más: si hay cambios (`sucio`), antes de cerrar se pregunta.
 *
 * `pedirCierre` va en todo lo que cierra el editor (X, Esc, clic fuera,
 * Cancelar); `dialogo` se pinta junto al editor.
 */
export function useCerrarConAviso(
  sucio: boolean,
  alCerrar: () => void,
  textos: { titulo?: string; descripcion?: string } = {},
): { pedirCierre: () => void; dialogo: ReactNode } {
  const [preguntando, setPreguntando] = useState(false);

  const pedirCierre = () => {
    if (sucio) setPreguntando(true);
    else alCerrar();
  };

  const dialogo = (
    <AlertDialog open={preguntando} onOpenChange={setPreguntando}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{textos.titulo ?? "¿Descartar los cambios?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {textos.descripcion ?? "Lo que escribiste aquí se va a perder."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Seguir editando</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setPreguntando(false);
              alCerrar();
            }}
          >
            Descartar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { pedirCierre, dialogo };
}
