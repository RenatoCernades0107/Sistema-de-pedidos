"use client";

import { useTransition } from "react";
import { ChevronDown, KeyRound, LogOut, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { cerrarSesion } from "@/app/login/acciones";
import { useStore } from "@/lib/store";
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
 * Quién eres y cómo salir. Sustituye al selector de rol del prototipo: el rol ya
 * no se elige, viene de la cuenta con la que entraste.
 *
 * `cuenta` es el usuario con el que se entra; `usuario` del store es el nombre.
 */
export function MenuUsuario({ cuenta }: { cuenta: string }) {
  const { usuario, rol, permisos } = useStore();
  const [saliendo, salir] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5 pr-2" />}>
        <UserRound className="text-muted-foreground size-3.5" />
        <span className="max-w-[8.5rem] truncate">{usuario}</span>
        <ChevronDown className="text-muted-foreground size-3.5" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {/* Base UI exige el label dentro de un grupo; suelto revienta al renderizar. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="text-sm font-medium">{permisos.nombre}</span>
            <span className="text-muted-foreground text-xs leading-snug font-normal">
              {cuenta}
            </span>
            <span className="text-muted-foreground text-xs leading-snug font-normal">
              {permisos.descripcion}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* No va en la navegación principal: no es una vista de pedidos. */}
          {rol === "administracion" && (
            <DropdownMenuItem render={<Link href="/equipo" />} className="gap-2">
              <Users className="size-4 shrink-0" />
              Equipo y avisos
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<Link href="/cuenta/contrasena" />} className="gap-2">
            <KeyRound className="size-4 shrink-0" />
            Cambiar contraseña
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={saliendo}
            onClick={() => salir(() => void cerrarSesion())}
            className="gap-2"
          >
            <LogOut className="size-4 shrink-0" />
            {saliendo ? "Saliendo…" : "Cerrar sesión"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
