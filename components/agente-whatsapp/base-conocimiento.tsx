"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Image as ImageIcon, Loader2, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { actualizarDocumento, crearDocumento, eliminarDocumento } from "@/app/(app)/agente-whatsapp/acciones";
import {
  BUCKET_CONOCIMIENTO,
  MAX_BYTES_DOCUMENTO,
  MIMES_DOCUMENTO,
  TIPOS_DOCUMENTO,
  esMimeDocumento,
  type DocumentoAgente,
  type TipoDocumento,
} from "@/lib/agente-whatsapp/tipos";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { pesoTexto } from "@/lib/cad/adjuntos";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const AUTOMATICO = "auto";

/** Pide procesar (o reindexar) un documento. Devuelve el error, o null. */
async function procesar(id: string): Promise<{ error: string | null; aviso: string | null }> {
  try {
    const r = await fetch(`/api/agente-whatsapp/documentos/${id}/procesar`, { method: "POST" });
    const json = (await r.json().catch(() => ({}))) as { error?: string; aviso?: string | null };
    if (!r.ok) return { error: json.error ?? "No se pudo procesar el archivo.", aviso: null };
    return { error: null, aviso: json.aviso ?? null };
  } catch {
    return { error: "No hay conexión con el servidor.", aviso: null };
  }
}

/**
 * Los archivos que el agente consulta (y puede enviar): catálogos, fichas
 * técnicas y fotos. Se suben directo a Storage y después se procesan: el texto
 * se parte en fragmentos con su vector, y una foto se describe con el modelo.
 */
export function BaseConocimiento({ documentos }: { documentos: DocumentoAgente[] }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<TipoDocumento | typeof AUTOMATICO>(AUTOMATICO);
  const [subiendo, setSubiendo] = useState<string[]>([]);
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());
  const [arrastrando, setArrastrando] = useState(false);
  const [editando, setEditando] = useState<DocumentoAgente | null>(null);
  const [porBorrar, setPorBorrar] = useState<DocumentoAgente | null>(null);

  const marcar = (id: string, si: boolean) =>
    setOcupados((s) => {
      const n = new Set(s);
      if (si) n.add(id);
      else n.delete(id);
      return n;
    });

  const subirUno = async (archivo: File) => {
    if (!esMimeDocumento(archivo.type)) {
      toast.error(`«${archivo.name}» no es un PDF ni una imagen (PNG, JPG, WEBP).`);
      return;
    }
    if (archivo.size > MAX_BYTES_DOCUMENTO) {
      toast.error(`«${archivo.name}» pesa más de ${MAX_BYTES_DOCUMENTO / 1024 / 1024} MB.`);
      return;
    }
    const tipoFinal: TipoDocumento =
      tipo !== AUTOMATICO ? tipo : archivo.type.startsWith("image/") ? "foto" : "catalogo";
    setSubiendo((s) => [...s, archivo.name]);
    try {
      const creado = await crearDocumento({ nombre: archivo.name, mime: archivo.type, tamano: archivo.size, tipo: tipoFinal });
      if (!creado.ok) {
        toast.error(`No se subió «${archivo.name}»`, { description: creado.error });
        return;
      }
      const { error } = await clienteNavegador()
        .storage.from(BUCKET_CONOCIMIENTO)
        .upload(creado.ruta, archivo, { contentType: archivo.type, upsert: false });
      if (error) {
        await eliminarDocumento(creado.id);
        toast.error(`No se subió «${archivo.name}»`, { description: "Intenta de nuevo." });
        return;
      }
      router.refresh();
      const r = await procesar(creado.id);
      if (r.error) toast.error(`«${archivo.name}» no se pudo procesar`, { description: r.error });
      else if (r.aviso) toast.warning(`«${archivo.name}» se indexó a medias`, { description: r.aviso });
      else toast.success(`«${archivo.name}» listo`);
    } finally {
      setSubiendo((s) => s.filter((n) => n !== archivo.name));
      router.refresh();
    }
  };

  const subir = async (archivos: FileList | File[]) => {
    // De a uno: cada uno procesa un PDF entero y pide sus vectores.
    for (const a of Array.from(archivos)) await subirUno(a);
  };

  const reindexar = async (d: DocumentoAgente) => {
    marcar(d.id, true);
    const r = await procesar(d.id);
    marcar(d.id, false);
    if (r.error) toast.error(`«${d.nombre}» no se pudo reindexar`, { description: r.error });
    else if (r.aviso) toast.warning(`«${d.nombre}» se indexó a medias`, { description: r.aviso });
    else toast.success(`«${d.nombre}» reindexado`);
    router.refresh();
  };

  const borrar = async (d: DocumentoAgente) => {
    setPorBorrar(null);
    marcar(d.id, true);
    const r = await eliminarDocumento(d.id);
    marcar(d.id, false);
    if (!r.ok) toast.error("No se borró", { description: r.error });
    router.refresh();
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          if (e.dataTransfer.files.length) subir(e.dataTransfer.files);
        }}
        className={cn(
          "bg-card flex flex-col gap-3 rounded-xl border border-dashed p-5 transition-colors sm:flex-row sm:items-center",
          arrastrando && "border-primary bg-primary/5",
        )}
      >
        <Upload className="text-muted-foreground size-8 shrink-0" aria-hidden />
        <div className="flex-1 text-sm">
          <p className="font-medium">Sube catálogos, fichas técnicas o fotos</p>
          <p className="text-muted-foreground text-xs">
            PDF o imágenes (PNG, JPG, WEBP) de hasta {MAX_BYTES_DOCUMENTO / 1024 / 1024} MB. Arrástralos aquí. Un PDF
            escaneado lo transcribe el modelo; a una foto le escribe una descripción que puedes corregir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoDocumento | typeof AUTOMATICO)}>
            <SelectTrigger className="w-40" aria-label="Tipo de los archivos">
              <SelectValue>{tipo === AUTOMATICO ? "Tipo automático" : TIPOS_DOCUMENTO[tipo]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTOMATICO}>Tipo automático</SelectItem>
              {Object.entries(TIPOS_DOCUMENTO).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => entrada.current?.click()} disabled={subiendo.length > 0}>
            {subiendo.length > 0 ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
            {subiendo.length > 0 ? "Procesando…" : "Elegir archivos"}
          </Button>
          <input
            ref={entrada}
            type="file"
            multiple
            hidden
            accept={MIMES_DOCUMENTO.join(",")}
            onChange={(e) => {
              if (e.target.files?.length) subir(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {subiendo.length > 0 && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Procesando {subiendo.join(", ")}… Un catálogo grande puede tardar un par de minutos.
        </p>
      )}

      <section className="bg-card overflow-hidden rounded-xl border">
        <header className="bg-muted/40 flex items-baseline justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Base de conocimiento</h2>
          <span className="text-muted-foreground text-xs">
            {documentos.length} {documentos.length === 1 ? "archivo" : "archivos"} ·{" "}
            {documentos.reduce((n, d) => n + d.fragmentos, 0)} fragmentos
          </span>
        </header>
        {documentos.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            Todavía no hay archivos. Sin ellos el agente igual da precios, dirección y formas de pago, pero no puede
            hablar de características ni enviar catálogos o fotos.
          </p>
        ) : (
          <ul className="divide-y">
            {documentos.map((d) => {
              const ocupado = ocupados.has(d.id) || d.estado === "procesando";
              return (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {d.mime.startsWith("image/") ? (
                      <ImageIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
                    ) : (
                      <FileText className="mt-0.5 size-5 shrink-0 text-red-500" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.nombre}</p>
                      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        <span>{TIPOS_DOCUMENTO[d.tipo]}</span>
                        <span>{pesoTexto(d.tamano)}</span>
                        {d.paginas !== null && <span>{d.paginas} pág.</span>}
                        <span>{d.fragmentos} {d.fragmentos === 1 ? "fragmento" : "fragmentos"}</span>
                        {!d.enviable && <span>no se envía</span>}
                      </p>
                      {d.descripcion && <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{d.descripcion}</p>}
                      {d.error && (
                        <p
                          className={cn(
                            "mt-1 flex items-start gap-1 text-xs",
                            d.estado === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400",
                          )}
                        >
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {d.error}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 self-end sm:self-center">
                    {d.estado === "procesando" || ocupados.has(d.id) ? (
                      <Badge variant="secondary">
                        <Loader2 className="animate-spin" />
                        Procesando
                      </Badge>
                    ) : d.estado === "error" ? (
                      <Badge variant="destructive">Error</Badge>
                    ) : (
                      <Badge variant="outline">Listo</Badge>
                    )}
                    <Button variant="ghost" size="icon-sm" aria-label={`Editar «${d.nombre}»`} disabled={ocupado} onClick={() => setEditando(d)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Reindexar «${d.nombre}»`} disabled={ocupado} onClick={() => reindexar(d)}>
                      <RefreshCw />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Borrar «${d.nombre}»`} disabled={ocupados.has(d.id)} onClick={() => setPorBorrar(d)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AlertDialog open={porBorrar !== null} onOpenChange={(v) => !v && setPorBorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{porBorrar?.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              El agente dejará de consultarlo y de enviarlo. Las pruebas que lo enviaron lo mostrarán como no disponible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => porBorrar && borrar(porBorrar)}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editando && (
        <EditarDocumento
          documento={editando}
          alCerrar={() => setEditando(null)}
          alReindexar={(d) => reindexar(d)}
        />
      )}
    </div>
  );
}

function EditarDocumento({
  documento,
  alCerrar,
  alReindexar,
}: {
  documento: DocumentoAgente;
  alCerrar: () => void;
  alReindexar: (d: DocumentoAgente) => void;
}) {
  const router = useRouter();
  const [datos, setDatos] = useState({
    nombre: documento.nombre,
    tipo: documento.tipo,
    descripcion: documento.descripcion,
    enviable: documento.enviable,
  });
  const [guardando, iniciar] = useTransition();
  const esFoto = documento.mime.startsWith("image/");

  const guardar = () =>
    iniciar(async () => {
      const r = await actualizarDocumento({ id: documento.id, ...datos });
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      alCerrar();
      router.refresh();
      if (r.reindexar) alReindexar({ ...documento, ...datos });
      else toast.success("Cambios guardados");
    });

  return (
    <Dialog open onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar archivo</DialogTitle>
          <DialogDescription>
            Si cambias el nombre, el tipo o la descripción, se vuelve a indexar para que el agente lo encuentre con lo
            nuevo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Campo label="Nombre">
            <Input value={datos.nombre} onChange={(e) => setDatos((d) => ({ ...d, nombre: e.target.value }))} />
          </Campo>
          <Campo label="Tipo">
            <Select value={datos.tipo} onValueChange={(v) => v && setDatos((d) => ({ ...d, tipo: v as TipoDocumento }))}>
              <SelectTrigger className="w-full">
                <SelectValue>{TIPOS_DOCUMENTO[datos.tipo]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPOS_DOCUMENTO).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo
            label={esFoto ? "Descripción de la foto" : "Nota (opcional)"}
            ayuda={
              esFoto
                ? "Es lo que el agente busca para saber qué muestra la foto: producto, material, color, uso."
                : "Algo que el PDF no dice y el agente debería saber (ej.: «catálogo 2026, precios no vigentes»)."
            }
          >
            <Textarea
              rows={5}
              value={datos.descripcion}
              onChange={(e) => setDatos((d) => ({ ...d, descripcion: e.target.value }))}
            />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={datos.enviable} onCheckedChange={(v) => setDatos((d) => ({ ...d, enviable: v === true }))} />
            El agente puede enviárselo al cliente
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !datos.nombre.trim()}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
