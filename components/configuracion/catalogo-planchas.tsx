"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, PackageCheck, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  activarSobrantesPorMaterial,
  actualizarGrupoPlancha,
  comprobarCodigosEnOdoo,
  crearGrupoPlancha,
  guardarFormatoPlancha,
} from "@/app/(app)/configuracion/acciones";
import { compactar } from "@/lib/busqueda-inteligente";
import {
  colorDe,
  espesorTexto,
  medidaDe,
  nombreDeGrupo,
  type FormatoPlancha,
  type GrupoPlancha,
} from "@/lib/cortes/catalogo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "todos";

/**
 * El catálogo de planchas: qué materiales se cortan, en qué tamaños vienen y
 * con qué código están en Odoo. De aquí sale la sugerencia de formato al
 * cotizar un corte.
 */
export function CatalogoPlanchas({ grupos, odooConectado }: { grupos: GrupoPlancha[]; odooConectado: boolean }) {
  const router = useRouter();
  const [material, setMaterial] = useState(TODOS);
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [faltan, setFaltan] = useState<string[] | null>(null);
  const [ocupado, iniciar] = useTransition();

  const materiales = useMemo(() => [...new Set(grupos.map((g) => g.material))], [grupos]);

  const visibles = useMemo(() => {
    // Compactado: "3mm", "3 mm" y "F7E-030" encuentran lo mismo.
    const palabras = texto.split(/\s+/).map(compactar).filter(Boolean);
    return grupos.filter((g) => {
      if (material !== TODOS && g.material !== material) return false;
      if (palabras.length === 0) return true;
      const donde = compactar(
        [nombreDeGrupo(g), ...g.formatos.flatMap((f) => [f.codigo, `${f.anchoCm}x${f.largoCm}`])].join(" "),
      );
      return palabras.every((p) => donde.includes(p));
    });
  }, [grupos, material, texto]);

  const porMaterial = useMemo(() => {
    const mapa = new Map<string, GrupoPlancha[]>();
    for (const g of visibles) mapa.set(g.material, [...(mapa.get(g.material) ?? []), g]);
    return [...mapa.entries()];
  }, [visibles]);

  const grupoEditado = grupos.find((g) => g.id === editando) ?? null;

  const cambiarGrupo = (g: GrupoPlancha, cambios: { rotable?: boolean; sobrantesActivo?: boolean }) =>
    iniciar(async () => {
      const r = await actualizarGrupoPlancha({ id: g.id, ...cambios });
      if (!r.ok) toast.error("No se guardó", { description: r.error });
      router.refresh();
    });

  const sobrantesDeMaterial = (nombre: string, activo: boolean) =>
    iniciar(async () => {
      const r = await activarSobrantesPorMaterial({ material: nombre, activo });
      if (!r.ok) toast.error("No se guardó", { description: r.error });
      else toast.success(`Sobrantes ${activo ? "encendidos" : "apagados"} para ${nombre}`);
      router.refresh();
    });

  const comprobar = () =>
    iniciar(async () => {
      const r = await comprobarCodigosEnOdoo();
      if (!r.ok) {
        toast.error("No se pudo comprobar", { description: r.error });
        return;
      }
      setFaltan(r.faltan);
      if (r.faltan.length === 0) toast.success(`Los ${r.total} códigos existen en Odoo`);
      else toast.warning(`${r.faltan.length} de ${r.total} códigos no están en Odoo`);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            aria-label="Filtrar planchas"
            placeholder="Material, color, espesor o código…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={material} onValueChange={(v) => v && setMaterial(v)}>
          <SelectTrigger className="w-56" aria-label="Material">
            <SelectValue>{material === TODOS ? "Todos los materiales" : material}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los materiales</SelectItem>
            {materiales.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={comprobar}
          disabled={ocupado || !odooConectado}
          title={odooConectado ? undefined : "Odoo no está conectado"}
        >
          <PackageCheck />
          Comprobar códigos en Odoo
        </Button>
        <Button className="gap-1.5" onClick={() => setCreando(true)}>
          <Plus />
          Nueva plancha
        </Button>
      </div>

      {faltan && faltan.length > 0 && (
        <div role="alert" className="border-destructive/30 bg-destructive/10 rounded-xl border px-4 py-3 text-sm">
          <p className="text-destructive font-medium">
            {faltan.length === 1 ? "Este código no existe" : "Estos códigos no existen"} en Odoo
          </p>
          <p className="mt-1 font-mono text-xs leading-relaxed break-words">{faltan.join(" · ")}</p>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Sin producto en Odoo no hay precio ni stock: corrige el código aquí o crea el producto allá.
          </p>
        </div>
      )}

      {porMaterial.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          Ninguna plancha coincide con el filtro.
        </p>
      )}

      {porMaterial.map(([nombre, lista]) => {
        const conSobrantes = lista.filter((g) => g.sobrantesActivo).length;
        return (
          <section key={nombre} className="bg-card overflow-hidden rounded-xl border">
            <header className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
              <h2 className="text-sm font-medium">{nombre}</h2>
              <span className="text-muted-foreground text-xs">
                {lista.length} {lista.length === 1 ? "combinación" : "combinaciones"}
                {conSobrantes > 0 && ` · ${conSobrantes} con sobrantes`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={ocupado}
                onClick={() => sobrantesDeMaterial(nombre, conSobrantes < lista.length)}
              >
                {conSobrantes < lista.length ? "Encender sobrantes en todo" : "Apagar sobrantes en todo"}
              </Button>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="px-4 py-2 font-medium">Color</th>
                    <th className="px-2 py-2 font-medium">Espesor</th>
                    <th className="px-2 py-2 font-medium">Formatos (cm) y código de Odoo</th>
                    <th className="px-2 py-2 text-center font-medium">Se puede girar</th>
                    <th className="px-2 py-2 text-center font-medium">Sobrantes</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((g) => (
                    <tr key={g.id} className="border-t align-top">
                      <td className="px-4 py-2.5 font-medium">{colorDe(g)}</td>
                      <td className="tnum px-2 py-2.5 whitespace-nowrap">{espesorTexto(g.espesorMm)}</td>
                      <td className="px-2 py-2">
                        <ul className="flex flex-wrap gap-1.5">
                          {g.formatos.map((f) => (
                            <li key={f.id}>
                              <ChipFormato formato={f} falta={faltan?.includes(f.codigo) ?? false} />
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <Checkbox
                          aria-label={`${nombreDeGrupo(g)}: se puede girar`}
                          checked={g.rotable}
                          disabled={ocupado}
                          onCheckedChange={(v) => cambiarGrupo(g, { rotable: v === true })}
                        />
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <Checkbox
                          aria-label={`${nombreDeGrupo(g)}: registrar sobrantes`}
                          checked={g.sobrantesActivo}
                          disabled={ocupado}
                          onCheckedChange={(v) => cambiarGrupo(g, { sobrantesActivo: v === true })}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground size-8"
                          aria-label={`Editar los formatos de ${nombreDeGrupo(g)}`}
                          onClick={() => setEditando(g.id)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {grupoEditado && <EditarFormatos grupo={grupoEditado} alCerrar={() => setEditando(null)} />}
      {creando && <NuevaPlancha materiales={materiales} alCerrar={() => setCreando(false)} />}
    </div>
  );
}

function ChipFormato({ formato: f, falta }: { formato: FormatoPlancha; falta: boolean }) {
  const aviso = falta
    ? "No existe en Odoo"
    : f.porVerificar
      ? "Código o medida por confirmar contra Odoo"
      : f.skuCompartido
        ? "Un solo código para todos los colores: el stock de Odoo no es por color"
        : null;
  return (
    <span
      title={[aviso, f.nota].filter(Boolean).join(" · ") || undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap",
        !f.activo && "text-muted-foreground line-through opacity-60",
        falta && "border-destructive/50 text-destructive",
      )}
    >
      <span className="tnum">{medidaDe(f)}</span>
      <span className="text-muted-foreground font-mono text-2xs">{f.codigo}</span>
      {(falta || f.porVerificar) && <CircleAlert className="text-destructive size-3" aria-label={aviso ?? ""} />}
      {!falta && !f.porVerificar && f.skuCompartido && (
        <span className="text-muted-foreground text-2xs" aria-label={aviso ?? ""}>
          varios colores
        </span>
      )}
    </span>
  );
}

interface FormatoEditable {
  id?: string;
  codigo: string;
  anchoCm: string;
  largoCm: string;
  skuCompartido: boolean;
  activo: boolean;
}

function EditarFormatos({ grupo, alCerrar }: { grupo: GrupoPlancha; alCerrar: () => void }) {
  const router = useRouter();
  const [filas, setFilas] = useState<FormatoEditable[]>(() =>
    grupo.formatos.map((f) => ({
      id: f.id,
      codigo: f.codigo,
      anchoCm: String(f.anchoCm),
      largoCm: String(f.largoCm),
      skuCompartido: f.skuCompartido,
      activo: f.activo,
    })),
  );
  const [guardando, iniciar] = useTransition();

  const cambiar = (i: number, cambios: Partial<FormatoEditable>) =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));

  const guardar = () =>
    iniciar(async () => {
      // De a uno: si el tercero falla, los dos primeros ya quedaron y se dice cuál no.
      for (const f of filas) {
        const original = grupo.formatos.find((o) => o.id === f.id);
        const igual =
          original &&
          original.codigo === f.codigo.trim() &&
          String(original.anchoCm) === f.anchoCm.trim() &&
          String(original.largoCm) === f.largoCm.trim() &&
          original.skuCompartido === f.skuCompartido &&
          original.activo === f.activo;
        if (igual) continue;
        const r = await guardarFormatoPlancha({ ...f, grupoId: grupo.id });
        if (!r.ok) {
          toast.error(`No se guardó ${f.codigo || "el formato nuevo"}`, { description: r.error });
          router.refresh();
          return;
        }
      }
      toast.success("Formatos guardados");
      router.refresh();
      alCerrar();
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{nombreDeGrupo(grupo)}</DialogTitle>
          <DialogDescription>
            Los tamaños en que viene esta plancha. Un formato que se desactiva deja de sugerirse, pero no
            se borra: los pedidos que ya lo usaron lo siguen mostrando.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {filas.map((f, i) => (
            <div key={f.id ?? `nuevo-${i}`} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
              <Campo label="Código de Odoo" className="col-span-2 sm:col-span-1">
                <Input value={f.codigo} onChange={(e) => cambiar(i, { codigo: e.target.value })} className="font-mono" />
              </Campo>
              <Campo label="Ancho (cm)">
                <Input inputMode="decimal" value={f.anchoCm} onChange={(e) => cambiar(i, { anchoCm: e.target.value })} className="tnum" />
              </Campo>
              <Campo label="Largo (cm)">
                <Input inputMode="decimal" value={f.largoCm} onChange={(e) => cambiar(i, { largoCm: e.target.value })} className="tnum" />
              </Campo>
              <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 pb-1.5 sm:col-span-1 sm:flex-col">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={f.activo} onCheckedChange={(v) => cambiar(i, { activo: v === true })} />
                  Activo
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={f.skuCompartido} onCheckedChange={(v) => cambiar(i, { skuCompartido: v === true })} />
                  Varios colores
                </label>
              </div>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                setFilas((fs) => [...fs, { codigo: "", anchoCm: "", largoCm: "", skuCompartido: false, activo: true }])
              }
            >
              <Plus className="size-3.5" />
              Agregar formato
            </Button>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar formatos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NuevaPlancha({ materiales, alCerrar }: { materiales: string[]; alCerrar: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({
    material: "",
    variante: "",
    detalle: "",
    espesorMm: "",
    codigo: "",
    anchoCm: "",
    largoCm: "",
    rotable: true,
  });
  const [guardando, iniciar] = useTransition();
  const poner = (cambios: Partial<typeof v>) => setV((p) => ({ ...p, ...cambios }));

  const crear = () =>
    iniciar(async () => {
      const r = await crearGrupoPlancha(v);
      if (!r.ok) {
        toast.error("No se creó la plancha", { description: r.error });
        return;
      }
      toast.success("Plancha agregada al catálogo");
      router.refresh();
      alCerrar();
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva plancha</DialogTitle>
          <DialogDescription>
            Si ya existe ese material en ese color y espesor, el formato se le agrega.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Material" requerido className="sm:col-span-2">
            <Input
              list="materiales-conocidos"
              placeholder="Ej. Acrílico ECO"
              value={v.material}
              onChange={(e) => poner({ material: e.target.value })}
            />
            <datalist id="materiales-conocidos">
              {materiales.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Campo>
          <Campo label="Variante" ayuda="Cristal, Blanco, Colores, Espejo…">
            <Input value={v.variante} onChange={(e) => poner({ variante: e.target.value })} />
          </Campo>
          <Campo label="Detalle" ayuda="Lechoso, Dorado… Puede ir vacío.">
            <Input value={v.detalle} onChange={(e) => poner({ detalle: e.target.value })} />
          </Campo>
          <Campo label="Espesor (mm)" requerido>
            <Input inputMode="decimal" value={v.espesorMm} onChange={(e) => poner({ espesorMm: e.target.value })} className="tnum" />
          </Campo>
          <Campo label="Código de Odoo" requerido>
            <Input value={v.codigo} onChange={(e) => poner({ codigo: e.target.value })} className="font-mono" />
          </Campo>
          <Campo label="Ancho (cm)" requerido>
            <Input inputMode="decimal" value={v.anchoCm} onChange={(e) => poner({ anchoCm: e.target.value })} className="tnum" />
          </Campo>
          <Campo label="Largo (cm)" requerido>
            <Input inputMode="decimal" value={v.largoCm} onChange={(e) => poner({ largoCm: e.target.value })} className="tnum" />
          </Campo>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm sm:col-span-2">
            <Checkbox checked={v.rotable} onCheckedChange={(c) => poner({ rotable: c === true })} />
            Las piezas se pueden girar al acomodarlas (sin veta ni dibujo)
          </label>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={crear} disabled={guardando}>
            {guardando ? "Creando…" : "Agregar al catálogo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
