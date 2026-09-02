"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ROLES, type Rol } from "@/lib/dominio";
import { enlazarTrabajador } from "@/app/(app)/notificaciones-acciones";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Trabajador {
  id: string;
  nombre: string;
  activo: boolean;
  usuario_id: string | null;
}

interface Usuario {
  id: string;
  nombre: string;
  usuario: string;
  rol: Rol;
}

/** El valor que usa el Select para "sin cuenta": un Select no admite value="". */
const SIN_CUENTA = "sin";

export function EquipoTabla({
  trabajadores,
  usuarios,
}: {
  trabajadores: Trabajador[];
  usuarios: Usuario[];
}) {
  /* El estado local es lo que se pinta mientras el servidor contesta, igual que
     el optimista del store: sin esto el Select vuelve al valor viejo hasta que
     llega el refresh y parece que no se guardó. */
  const [enlaces, setEnlaces] = useState<Record<string, string | null>>(
    () => Object.fromEntries(trabajadores.map((t) => [t.id, t.usuario_id])),
  );
  const [guardando, guardar] = useTransition();

  function cambiar(trabajador: Trabajador, valor: string) {
    const usuarioId = valor === SIN_CUENTA ? null : valor;
    const anterior = enlaces[trabajador.id] ?? null;
    if (usuarioId === anterior) return;

    setEnlaces((e) => ({ ...e, [trabajador.id]: usuarioId }));

    guardar(async () => {
      const resultado = await enlazarTrabajador({ trabajadorId: trabajador.id, usuarioId });

      if (!resultado.ok) {
        setEnlaces((e) => ({ ...e, [trabajador.id]: anterior }));
        toast.error("No se guardó el enlace", { description: resultado.error });
        return;
      }

      toast.success(
        usuarioId
          ? `${trabajador.nombre} recibirá sus avisos`
          : `${trabajador.nombre} ya no recibirá avisos`,
      );
    });
  }

  /* Una cuenta pertenece a un solo trabajador (la columna es UNIQUE). Sacar de la
     lista las ya tomadas evita ofrecer una opción que la base va a rechazar. */
  const tomadas = new Set(Object.values(enlaces).filter(Boolean) as string[]);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trabajador</TableHead>
            <TableHead>Cuenta enlazada</TableHead>
            <TableHead className="w-40">Avisos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trabajadores.map((t) => {
            const enlazado = enlaces[t.id] ?? null;
            const disponibles = usuarios.filter((u) => !tomadas.has(u.id) || u.id === enlazado);

            return (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {t.nombre}
                  {!t.activo && (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      (inactivo)
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <Select
                    value={enlazado ?? SIN_CUENTA}
                    onValueChange={(v) => v && cambiar(t, v)}
                  >
                    <SelectTrigger className="w-full max-w-64" disabled={guardando}>
                      <SelectValue>
                        {usuarios.find((u) => u.id === enlazado)?.nombre ?? "Sin cuenta"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_CUENTA}>Sin cuenta</SelectItem>
                      {disponibles.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.nombre} · {ROLES[u.rol].nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell>
                  {enlazado ? (
                    <Badge variant="secondary">Los recibe</Badge>
                  ) : (
                    /* El punto de la pantalla: que se vea de un vistazo quién se
                       está quedando sin enterar de sus pedidos. */
                    <Badge variant="outline" className="text-muted-foreground">
                      No recibe avisos
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
