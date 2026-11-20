"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, Mail, MailPlus, MoreHorizontal, Power, PowerOff, Trash2, UserPlus } from "lucide-react";
import { ROLES, type Rol } from "@/lib/dominio";
import {
  desactivarUsuario,
  eliminarUsuario,
  enviarCorreoDeRecuperacion,
  reactivarUsuario,
  restablecerContrasenaDe,
} from "@/app/(app)/usuarios/acciones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DialogoClave } from "./dialogo-clave";
import { DialogoCorreo } from "./dialogo-correo";
import { DialogoNuevoUsuario } from "./dialogo-nuevo-usuario";

export interface Cuenta {
  id: string;
  nombre: string;
  usuario: string;
  rol: Rol;
  activo: boolean;
  email_recuperacion: string | null;
}

type Confirmacion = { tipo: "desactivar" | "restablecer" | "eliminar"; cuenta: Cuenta } | null;

export function TablaUsuarios({ usuarios, yoId }: { usuarios: Cuenta[]; yoId: string }) {
  const [creando, setCreando] = useState(false);
  const [correoDe, setCorreoDe] = useState<Cuenta | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmacion>(null);
  const [clave, setClave] = useState<{ password: string; motivo: "creada" | "restablecida"; nombre: string } | null>(
    null,
  );
  const [ocupado, iniciar] = useTransition();

  function reactivar(c: Cuenta) {
    iniciar(async () => {
      const r = await reactivarUsuario({ id: c.id });
      if (r.ok) toast.success(`${c.nombre} puede volver a entrar`);
      else toast.error("No se pudo reactivar", { description: r.error });
    });
  }

  function enviarCorreo(c: Cuenta) {
    iniciar(async () => {
      const r = await enviarCorreoDeRecuperacion({ id: c.id });
      if (r.ok) toast.success("Correo enviado", { description: c.email_recuperacion ?? undefined });
      else toast.error("No se pudo enviar el correo", { description: r.error });
    });
  }

  function ejecutarConfirmacion() {
    if (!confirmar) return;
    const { tipo, cuenta } = confirmar;
    setConfirmar(null);

    iniciar(async () => {
      if (tipo === "desactivar") {
        const r = await desactivarUsuario({ id: cuenta.id });
        if (r.ok) toast.success(`${cuenta.nombre} ya no puede entrar`);
        else toast.error("No se pudo desactivar", { description: r.error });
        return;
      }

      if (tipo === "eliminar") {
        const r = await eliminarUsuario({ id: cuenta.id });
        if (r.ok) toast.success(`Se eliminó la cuenta de ${cuenta.nombre}`);
        else toast.error("No se pudo eliminar", { description: r.error });
        return;
      }

      const r = await restablecerContrasenaDe({ id: cuenta.id });
      if (r.ok && r.password) setClave({ password: r.password, motivo: "restablecida", nombre: cuenta.nombre });
      else if (!r.ok) toast.error("No se pudo restablecer", { description: r.error });
    });
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreando(true)} className="gap-2">
          <UserPlus className="size-4" />
          Nueva cuenta
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuenta</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Correo de recuperación</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((c) => {
              const esYo = c.id === yoId;
              return (
                <TableRow key={c.id} className={c.activo ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="font-medium">
                      {c.nombre}
                      {esYo && <span className="text-muted-foreground ml-2 text-xs font-normal">(tú)</span>}
                      {!c.activo && (
                        <Badge variant="outline" className="text-muted-foreground ml-2 align-middle">
                          Desactivada
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">{c.usuario}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLES[c.rol].nombre}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.email_recuperacion ?? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Sin correo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" disabled={ocupado} />}
                      >
                        <MoreHorizontal className="size-4" />
                        <span className="sr-only">Acciones de {c.nombre}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => setCorreoDe(c)} className="gap-2">
                            <MailPlus className="size-4 shrink-0" />
                            {c.email_recuperacion ? "Cambiar correo" : "Registrar correo"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!c.email_recuperacion || !c.activo}
                            onClick={() => enviarCorreo(c)}
                            className="gap-2"
                          >
                            <Mail className="size-4 shrink-0" />
                            Enviar correo de recuperación
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={esYo || !c.activo}
                            onClick={() => setConfirmar({ tipo: "restablecer", cuenta: c })}
                            className="gap-2"
                          >
                            <KeyRound className="size-4 shrink-0" />
                            Contraseña temporal
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {c.activo ? (
                            <DropdownMenuItem
                              disabled={esYo}
                              onClick={() => setConfirmar({ tipo: "desactivar", cuenta: c })}
                              className="text-destructive gap-2"
                            >
                              <PowerOff className="size-4 shrink-0" />
                              Desactivar cuenta
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => reactivar(c)} className="gap-2">
                                <Power className="size-4 shrink-0" />
                                Reactivar cuenta
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={esYo}
                                onClick={() => setConfirmar({ tipo: "eliminar", cuenta: c })}
                                className="text-destructive gap-2"
                              >
                                <Trash2 className="size-4 shrink-0" />
                                Eliminar cuenta
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DialogoNuevoUsuario
        abierto={creando}
        alCerrar={() => setCreando(false)}
        alCrear={(c) => setClave({ ...c, motivo: "creada" })}
      />

      <DialogoCorreo
        cuenta={correoDe && { id: correoDe.id, nombre: correoDe.nombre, correo: correoDe.email_recuperacion }}
        alCerrar={() => setCorreoDe(null)}
      />

      <DialogoClave
        clave={clave && { password: clave.password, motivo: clave.motivo }}
        nombre={clave?.nombre ?? ""}
        alCerrar={() => setClave(null)}
      />

      <AlertDialog open={confirmar !== null} onOpenChange={(v) => !v && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar?.tipo === "desactivar"
                ? `¿Desactivar la cuenta de ${confirmar.cuenta.nombre}?`
                : confirmar?.tipo === "eliminar"
                  ? `¿Eliminar la cuenta de ${confirmar.cuenta.nombre}?`
                  : `¿Poner una contraseña temporal a ${confirmar?.cuenta.nombre}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar?.tipo === "desactivar"
                ? "Dejará de poder entrar y se cerrarán sus sesiones abiertas. Sus pedidos y su historial se conservan, y puedes reactivarla cuando quieras."
                : confirmar?.tipo === "eliminar"
                  ? "Se borra para siempre y no se puede deshacer. Solo es posible si no tiene pedidos ni otros registros; si los tiene, déjala desactivada."
                  : "Su contraseña actual deja de servir, se cierran sus sesiones abiertas y tendrá que elegir una nueva al entrar. La temporal se muestra una sola vez."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmar?.tipo === "restablecer" ? "default" : "destructive"}
              onClick={ejecutarConfirmacion}
            >
              {confirmar?.tipo === "desactivar"
                ? "Desactivar"
                : confirmar?.tipo === "eliminar"
                  ? "Eliminar"
                  : "Generar contraseña"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
