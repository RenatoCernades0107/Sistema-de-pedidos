"use client";

import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, Eye } from "lucide-react";
import { useStore } from "@/lib/store";
import { ROLES, VISTAS, type Rol, type Vista } from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Herramienta del prototipo: permite comprobar en vivo qué ve cada rol.
 * Cuando entre la autenticación real, esto se cae y el rol viene de la sesión.
 */
export function SelectorRol() {
  const { rol, setRol, permisos } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  /* Cambiar de rol cambia también lo que ese rol puede ver: si la vista abierta
     no está entre las suyas, se cae a su vista inicial en vez de dejar en
     pantalla una lista que no le corresponde. El detalle de un pedido no es una
     vista, así que se queda donde está. */
  const cambiar = (r: Rol) => {
    setRol(r);
    const actual = pathname.slice(1) as Vista;
    const esVista = actual in VISTAS;
    if (esVista && !ROLES[r].vistas.includes(actual)) {
      router.push(`/${ROLES[r].vistaInicial}`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="gap-1.5 pr-2" />}
      >
        <Eye className="text-muted-foreground size-3.5" />
        <span className="max-w-[8.5rem] truncate">{permisos.nombre}</span>
        <ChevronDown className="text-muted-foreground size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {/* El label es la etiqueta accesible del grupo: Base UI lo exige dentro
            de <Menu.Group> y sin grupo revienta al renderizar. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-2xs text-muted-foreground font-medium tracking-[0.08em] uppercase">
            Ver la app como
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.keys(ROLES) as Rol[]).map((r) => (
            <DropdownMenuItem
              key={r}
              onClick={() => cambiar(r)}
              className="flex items-start gap-2.5 py-2"
            >
              <Check className={cnCheck(r === rol)} aria-hidden={r !== rol} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {ROLES[r].nombre}
                </span>
                <span className="text-muted-foreground block text-xs leading-snug">
                  {ROLES[r].descripcion}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const cnCheck = (activo: boolean) =>
  activo
    ? "size-4 shrink-0 mt-0.5 text-primary"
    : "size-4 shrink-0 mt-0.5 opacity-0";
