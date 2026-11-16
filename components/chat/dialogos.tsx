"use client";

/**
 * Los diálogos del chat: abrir un directo, y los de Administración para crear
 * y editar canales. Todo pasa por las funciones de la base (`abrir_directo`,
 * `crear_canal`, `editar_canal`), que son las que deciden quién puede.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectorPersonas } from "./personas";
import { recargarResumen } from "./use-resumen";

const MAX_NOMBRE = 60;
const MAX_DESCRIPCION = 280;

export function NuevoDirecto({
  abierto,
  onCambio,
  usuarioId,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  usuarioId: string;
}) {
  const router = useRouter();
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const elegir = async (id: string) => {
    setAbriendo(id);
    const { data, error } = await clienteNavegador().rpc("abrir_directo", { p_usuario_id: id });
    setAbriendo(null);
    if (error || !data) {
      toast.error("No se pudo abrir la conversación", { description: error?.message });
      return;
    }
    onCambio(false);
    void recargarResumen();
    router.push(`/chat/${data}`);
  };

  return (
    <Dialog open={abierto} onOpenChange={onCambio}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo mensaje directo</DialogTitle>
          <DialogDescription>Solo lo ven ustedes dos.</DialogDescription>
        </DialogHeader>
        {abierto && (
          <SelectorPersonas excluir={[usuarioId]} onElegir={(p) => void elegir(p.id)} ocupado={abriendo} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Nombre y descripción, compartido por crear y editar. */
function CamposCanal({
  nombre,
  descripcion,
  onNombre,
  onDescripcion,
}: {
  nombre: string;
  descripcion: string;
  onNombre: (v: string) => void;
  onDescripcion: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nombre
        <Input
          value={nombre}
          onChange={(e) => onNombre(e.target.value)}
          maxLength={MAX_NOMBRE}
          placeholder="Taller, Despachos…"
          autoFocus
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>
          Descripción <span className="text-muted-foreground font-normal">(opcional)</span>
        </span>
        <Textarea
          value={descripcion}
          onChange={(e) => onDescripcion(e.target.value)}
          maxLength={MAX_DESCRIPCION}
          rows={2}
          placeholder="Para qué es este canal"
        />
      </label>
    </div>
  );
}

export function NuevoCanal({
  abierto,
  onCambio,
  usuarioId,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  usuarioId: string;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [miembros, setMiembros] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (v: boolean) => {
    if (!v) {
      setNombre("");
      setDescripcion("");
      setMiembros([]);
    }
    onCambio(v);
  };

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    const { data, error } = await clienteNavegador().rpc("crear_canal", {
      p_nombre: nombre.trim(),
      p_descripcion: descripcion.trim() || null,
      p_miembros: miembros,
    });
    setGuardando(false);
    if (error || !data) {
      toast.error("No se pudo crear el canal", { description: error?.message });
      return;
    }
    cambiar(false);
    void recargarResumen();
    router.push(`/chat/${data}`);
  };

  return (
    <Dialog open={abierto} onOpenChange={cambiar}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={crear} className="flex min-h-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo canal</DialogTitle>
            <DialogDescription>Solo lo ven las personas que elijas. Tú entras siempre.</DialogDescription>
          </DialogHeader>
          <CamposCanal nombre={nombre} descripcion={descripcion} onNombre={setNombre} onDescripcion={setDescripcion} />
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">
              Miembros <span className="text-muted-foreground font-normal">({miembros.length} elegidos)</span>
            </p>
            {abierto && (
              <SelectorPersonas
                multiple
                excluir={[usuarioId]}
                elegidos={miembros}
                onElegir={(p) =>
                  setMiembros((m) => (m.includes(p.id) ? m.filter((x) => x !== p.id) : [...m, p.id]))
                }
              />
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={guardando || !nombre.trim()}>
              {guardando && <Loader2 className="animate-spin" />}
              Crear canal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditarCanal({
  abierto,
  onCambio,
  conversacionId,
  nombreActual,
  descripcionActual,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  conversacionId: string;
  nombreActual: string;
  descripcionActual: string | null;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(nombreActual);
  const [descripcion, setDescripcion] = useState(descripcionActual ?? "");
  const [guardando, setGuardando] = useState(false);

  const cambiar = (v: boolean) => {
    if (v) {
      setNombre(nombreActual);
      setDescripcion(descripcionActual ?? "");
    }
    onCambio(v);
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    const { error } = await clienteNavegador().rpc("editar_canal", {
      p_conversacion_id: conversacionId,
      p_nombre: nombre.trim(),
      p_descripcion: descripcion.trim() || null,
    });
    setGuardando(false);
    if (error) {
      toast.error("No se guardó el canal", { description: error.message });
      return;
    }
    onCambio(false);
    void recargarResumen();
    router.refresh();
  };

  return (
    <Dialog open={abierto} onOpenChange={cambiar}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Editar canal</DialogTitle>
          </DialogHeader>
          <CamposCanal nombre={nombre} descripcion={descripcion} onNombre={setNombre} onDescripcion={setDescripcion} />
          <DialogFooter>
            <Button type="submit" disabled={guardando || !nombre.trim()}>
              {guardando && <Loader2 className="animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
