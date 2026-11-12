"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  guardarAjustesTerminados,
  guardarOpcionTerminado,
  guardarProductoTerminado,
} from "@/app/(app)/configuracion/acciones";
import {
  CLASES_OPCION,
  buscarProductos,
  textoDeMedidaEstandar,
  type CatalogoTerminados as Catalogo,
  type ClaseOpcion,
  type Opcion,
  type ProductoEstandar,
} from "@/lib/terminados/catalogo";
import { GEOMETRIAS, type Geometria } from "@/lib/terminados/geometria";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
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

const TODOS = "todos";
const CLASES = Object.keys(CLASES_OPCION) as ClaseOpcion[];

const t = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const num = (s: string) => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};

/**
 * El catálogo de productos terminados: qué se fabrica, en qué medidas y con qué
 * opciones, y los números de los que sale el precio sugerido (merma, factor de
 * cada tipo, extra de cada opción).
 */
export function CatalogoTerminados({ catalogo }: { catalogo: Catalogo }) {
  const [tipo, setTipo] = useState(TODOS);
  const [texto, setTexto] = useState("");
  /** El código del producto en edición, o "" para uno nuevo. */
  const [editando, setEditando] = useState<string | null>(null);

  const visibles = useMemo(
    () =>
      buscarProductos(
        catalogo.productos.filter((p) => tipo === TODOS || p.tipo === tipo),
        texto,
      ),
    [catalogo, tipo, texto],
  );
  const nombreDeTipo = (codigo: string) => catalogo.tipos.find((x) => x.codigo === codigo)?.nombre ?? codigo;

  return (
    <div className="flex flex-col gap-6">
      <Ajustes catalogo={catalogo} />

      <section className="flex flex-col gap-3" aria-labelledby="pt-productos">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="pt-productos" className="text-sm font-semibold">
            Productos <span className="text-muted-foreground tnum font-normal">{catalogo.productos.length}</span>
          </h2>
          <div className="relative ml-auto min-w-48 flex-1 sm:max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              aria-label="Filtrar productos terminados"
              placeholder="Nombre o código…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setEditando("")}>
            <Plus className="size-3.5" />
            Nuevo producto
          </Button>
        </div>
        <Campo grupo label="Tipo" claseEtiqueta="sr-only">
          <Opciones
            valores={[tipo]}
            onToggle={setTipo}
            opciones={[{ valor: TODOS, label: "Todos" }, ...catalogo.tipos.map((x) => ({ valor: x.codigo, label: x.nombre }))]}
          />
        </Campo>

        <ul className="bg-card divide-y rounded-xl border">
          {visibles.map((p) => (
            <li key={p.codigo} className={cn("flex items-start gap-3 px-4 py-2.5", !p.activo && "opacity-60")}>
              <span className="bg-muted/60 mt-0.5 shrink-0 rounded border px-1.5 py-px font-mono text-xs">{p.codigo}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {p.nombre}
                  {!p.activo && <span className="text-muted-foreground ml-2 text-xs font-normal">De baja</span>}
                </p>
                <p className="text-muted-foreground text-xs">
                  {nombreDeTipo(p.tipo)} · {GEOMETRIAS[p.geometria].nombre} · {p.medidas.length}{" "}
                  {p.medidas.length === 1 ? "medida" : "medidas"} · {p.opciones.length} opciones
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Editar ${p.codigo}`} onClick={() => setEditando(p.codigo)}>
                <Pencil />
              </Button>
            </li>
          ))}
          {visibles.length === 0 && (
            <li className="text-muted-foreground px-4 py-6 text-center text-sm">Ningún producto coincide.</li>
          )}
        </ul>
      </section>

      <OpcionesDelCatalogo opciones={catalogo.opciones} />

      {editando !== null && (
        <EditorProducto
          catalogo={catalogo}
          producto={catalogo.productos.find((p) => p.codigo === editando) ?? null}
          alCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

/* ── Merma y factores ──────────────────────────────────────────────────────── */

function Ajustes({ catalogo }: { catalogo: Catalogo }) {
  const router = useRouter();
  const [merma, setMerma] = useState(String(catalogo.config.mermaPct));
  const [letra, setLetra] = useState(String(catalogo.config.anchoDeLetra));
  const [factores, setFactores] = useState(() =>
    Object.fromEntries(catalogo.tipos.map((x) => [x.codigo, String(x.factor)])),
  );
  const [ocupado, iniciar] = useTransition();

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarAjustesTerminados({ mermaPct: merma, anchoDeLetra: letra, factores });
      if (r.ok) toast.success("Ajustes guardados");
      else toast.error("No se guardó", { description: r.error });
      router.refresh();
    });

  return (
    <section className="bg-card flex flex-col gap-4 rounded-xl border p-4" aria-labelledby="pt-ajustes">
      <div>
        <h2 id="pt-ajustes" className="text-sm font-semibold">
          Cómo se calcula el precio sugerido
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Costo del material estimado (con la merma) × factor del tipo + el extra de cada opción elegida. Quien cotiza
          puede cambiar el precio.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Campo label="Merma (%)" className="w-32" ayuda="Sobre el área de las piezas.">
          <Input inputMode="decimal" className="tnum" value={merma} onChange={(e) => setMerma(e.target.value)} />
        </Campo>
        <Campo label="Ancho de letra" className="w-40" ayuda="Proporción de la altura.">
          <Input inputMode="decimal" className="tnum" value={letra} onChange={(e) => setLetra(e.target.value)} />
        </Campo>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">Factor de fabricación por tipo</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {catalogo.tipos.map((x) => (
            <Campo key={x.codigo} label={x.nombre}>
              <Input
                inputMode="decimal"
                className="tnum"
                value={factores[x.codigo] ?? ""}
                onChange={(e) => setFactores((f) => ({ ...f, [x.codigo]: e.target.value }))}
              />
            </Campo>
          ))}
        </div>
      </fieldset>
      <Button className="self-start" onClick={guardar} disabled={ocupado}>
        {ocupado ? "Guardando…" : "Guardar ajustes"}
      </Button>
    </section>
  );
}

/* ── Opciones y sus extras ─────────────────────────────────────────────────── */

function OpcionesDelCatalogo({ opciones }: { opciones: Opcion[] }) {
  const router = useRouter();
  const [clase, setClase] = useState<ClaseOpcion>("personalizacion");
  const [extras, setExtras] = useState<Record<number, string>>({});
  const [nueva, setNueva] = useState("");
  const [ocupado, iniciar] = useTransition();

  const guardar = (datos: { id?: number; clase: ClaseOpcion; nombre: string; extra: string | number }) =>
    iniciar(async () => {
      const r = await guardarOpcionTerminado(datos);
      if (!r.ok) toast.error("No se guardó", { description: r.error });
      else if (!datos.id) setNueva("");
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="pt-opciones">
      <div>
        <h2 id="pt-opciones" className="text-sm font-semibold">
          Opciones y lo que suman al precio
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          El extra es por unidad. Qué opciones admite cada producto se elige al editar el producto.
        </p>
      </div>
      <Campo grupo label="Clase" claseEtiqueta="sr-only">
        <Opciones
          valores={[clase]}
          onToggle={(v) => setClase(v as ClaseOpcion)}
          opciones={CLASES.map((c) => ({ valor: c, label: CLASES_OPCION[c] }))}
        />
      </Campo>
      <ul className="bg-card divide-y rounded-xl border">
        {opciones
          .filter((o) => o.clase === clase)
          .map((o) => {
            const escrito = extras[o.id] ?? String(o.extra);
            const cambiado = num(escrito) !== null && num(escrito) !== o.extra;
            return (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 text-sm">{o.nombre}</span>
                <span className="text-muted-foreground text-xs">S/</span>
                <Input
                  inputMode="decimal"
                  aria-label={`Extra de ${o.nombre}`}
                  className="tnum h-8 w-24 text-right"
                  value={escrito}
                  onChange={(e) => setExtras((x) => ({ ...x, [o.id]: e.target.value }))}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!cambiado || ocupado}
                  onClick={() => guardar({ id: o.id, clase: o.clase, nombre: o.nombre, extra: escrito })}
                >
                  Guardar
                </Button>
              </li>
            );
          })}
        <li className="flex items-center gap-3 px-4 py-2">
          <Input
            aria-label="Nueva opción"
            placeholder={`Nueva opción en ${CLASES_OPCION[clase].toLowerCase()}…`}
            className="h-8 flex-1"
            value={nueva}
            maxLength={120}
            onChange={(e) => setNueva(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={nueva.trim().length < 2 || ocupado}
            onClick={() => guardar({ clase, nombre: nueva, extra: 0 })}
          >
            Agregar
          </Button>
        </li>
      </ul>
    </section>
  );
}

/* ── Un producto ───────────────────────────────────────────────────────────── */

interface FilaMedida {
  m1: string;
  m2: string;
  m3: string;
  diametro: string;
  altura: string;
  alturaMax: string;
  formato: string;
}
interface FilaEspesor {
  minMm: string;
  maxMm: string;
  aplicacion: string;
}

const MEDIDA_VACIA: FilaMedida = { m1: "", m2: "", m3: "", diametro: "", altura: "", alturaMax: "", formato: "" };
const COLUMNAS_MEDIDA: [keyof FilaMedida, string][] = [
  ["m1", "Medida 1"],
  ["m2", "Medida 2"],
  ["m3", "Medida 3"],
  ["diametro", "Diámetro"],
  ["altura", "Altura"],
  ["alturaMax", "Altura máx."],
  ["formato", "Formato"],
];

function EditorProducto({
  catalogo,
  producto: p,
  alCerrar,
}: {
  catalogo: Catalogo;
  /** `null`: uno nuevo. */
  producto: ProductoEstandar | null;
  alCerrar: () => void;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState(p?.tipo ?? catalogo.tipos[0]?.codigo ?? "");
  const [nombre, setNombre] = useState(p?.nombre ?? "");
  const [usos, setUsos] = useState(p?.usos ?? "");
  const [notas, setNotas] = useState(p?.notas ?? "");
  const [aMedida, setAMedida] = useState(p?.aMedida ?? false);
  const [activo, setActivo] = useState(p?.activo ?? true);
  const [geometria, setGeometria] = useState<Geometria>(p?.geometria ?? "manual");
  const [medidas, setMedidas] = useState<FilaMedida[]>(() =>
    (p?.medidas ?? []).map((m) => ({
      m1: t(m.m1),
      m2: t(m.m2),
      m3: t(m.m3),
      diametro: t(m.diametro),
      altura: t(m.altura),
      alturaMax: t(m.alturaMax),
      formato: m.formato ?? "",
    })),
  );
  const [espesores, setEspesores] = useState<FilaEspesor[]>(() =>
    (p?.espesores ?? []).map((e) => ({ minMm: t(e.minMm), maxMm: t(e.maxMm), aplicacion: e.aplicacion ?? "" })),
  );
  const [colores, setColores] = useState<number[]>(() =>
    catalogo.colores.filter((c) => p?.colores.includes(c.nombre)).map((c) => c.id),
  );
  /** Por id de opción: si el producto la admite y, de admitirla, si es opcional. */
  const [opciones, setOpciones] = useState<Map<number, boolean>>(
    () => new Map((p?.opciones ?? []).map((o) => [o.opcionId, o.opcional])),
  );
  const [ocupado, iniciar] = useTransition();

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarProductoTerminado({
        codigo: p?.codigo,
        tipo,
        nombre,
        usos: usos || null,
        notas: notas || null,
        aMedida,
        activo,
        geometria,
        medidas: medidas.map((m) => ({
          m1: num(m.m1),
          m2: num(m.m2),
          m3: num(m.m3),
          diametro: num(m.diametro),
          altura: num(m.altura),
          alturaMax: num(m.alturaMax),
          formato: m.formato || null,
        })),
        espesores: espesores.map((e) => ({
          minMm: e.minMm,
          maxMm: e.maxMm.trim() ? e.maxMm : e.minMm,
          aplicacion: e.aplicacion || null,
        })),
        colores,
        opciones: [...opciones].map(([opcionId, opcional]) => ({ opcionId, opcional })),
      });
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success(`${r.codigo} guardado`);
      router.refresh();
      alCerrar();
    });

  const alternarOpcion = (id: number) =>
    setOpciones((prev) => {
      const sig = new Map(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.set(id, true);
      return sig;
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{p ? `Editar ${p.codigo}` : "Nuevo producto terminado"}</DialogTitle>
          <DialogDescription>
            {p
              ? "Lo que cambies vale para lo que se cotice desde ahora; lo ya cotizado conserva su ficha."
              : "El código lo pone el sistema: el siguiente de su tipo."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
          <Campo grupo label="Tipo">
            <Opciones
              valores={[tipo]}
              // El código lleva el prefijo del tipo: una vez creado, no cambia.
              onToggle={(v) => !p && setTipo(v)}
              opciones={catalogo.tipos.map((x) => ({ valor: x.codigo, label: x.nombre }))}
            />
          </Campo>
          <Campo label="Nombre" requerido>
            <Input value={nombre} maxLength={200} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Usos de referencia">
              <Input value={usos} maxLength={300} onChange={(e) => setUsos(e.target.value)} />
            </Campo>
            <Campo label="Notas">
              <Input value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} />
            </Campo>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-primary size-4" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
              Activo (se puede cotizar)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-primary size-4" checked={aMedida} onChange={(e) => setAMedida(e.target.checked)} />
              Se fabrica a medida
            </label>
          </div>

          <Campo grupo label="Cómo se estima el material" ayuda={`Área de una unidad: ${GEOMETRIAS[geometria].formula}.`}>
            <Opciones
              valores={[geometria]}
              onToggle={(v) => setGeometria(v as Geometria)}
              opciones={(Object.keys(GEOMETRIAS) as Geometria[]).map((g) => ({ valor: g, label: GEOMETRIAS[g].nombre }))}
            />
          </Campo>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium">
              Medidas estándar <span className="text-muted-foreground font-normal">(cm)</span>
            </legend>
            {medidas.map((m, i) => (
              <div key={i} className="flex flex-wrap items-end gap-1.5" role="group" aria-label={`Medida ${i + 1}`}>
                {COLUMNAS_MEDIDA.map(([k, etiqueta]) => (
                  <Campo key={k} label={etiqueta} className="w-20" claseEtiqueta={i ? "sr-only" : undefined}>
                    <Input
                      inputMode={k === "formato" ? "text" : "decimal"}
                      className="tnum h-8"
                      value={m[k]}
                      onChange={(e) => setMedidas((ms) => ms.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                    />
                  </Campo>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar la medida ${i + 1}`}
                  onClick={() => setMedidas((ms) => ms.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 self-start" onClick={() => setMedidas((ms) => [...ms, MEDIDA_VACIA])}>
              <Plus className="size-3.5" />
              Agregar medida
            </Button>
            {p && p.medidas.length > 0 && (
              <p className="text-muted-foreground text-xs">Hoy: {p.medidas.map(textoDeMedidaEstandar).join(" · ")}</p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium">
              Espesores recomendados <span className="text-muted-foreground font-normal">(mm)</span>
            </legend>
            {espesores.map((e, i) => (
              <div key={i} className="flex flex-wrap items-end gap-1.5" role="group" aria-label={`Espesor ${i + 1}`}>
                <Campo label="Desde" className="w-20" claseEtiqueta={i ? "sr-only" : undefined}>
                  <Input
                    inputMode="decimal"
                    className="tnum h-8"
                    value={e.minMm}
                    onChange={(ev) => setEspesores((es) => es.map((x, j) => (j === i ? { ...x, minMm: ev.target.value } : x)))}
                  />
                </Campo>
                <Campo label="Hasta" className="w-20" claseEtiqueta={i ? "sr-only" : undefined}>
                  <Input
                    inputMode="decimal"
                    className="tnum h-8"
                    value={e.maxMm}
                    onChange={(ev) => setEspesores((es) => es.map((x, j) => (j === i ? { ...x, maxMm: ev.target.value } : x)))}
                  />
                </Campo>
                <Campo label="Para" className="min-w-32 flex-1" claseEtiqueta={i ? "sr-only" : undefined}>
                  <Input
                    className="h-8"
                    placeholder="Pequeña, base, A4…"
                    value={e.aplicacion}
                    maxLength={60}
                    onChange={(ev) => setEspesores((es) => es.map((x, j) => (j === i ? { ...x, aplicacion: ev.target.value } : x)))}
                  />
                </Campo>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar el espesor ${i + 1}`}
                  onClick={() => setEspesores((es) => es.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 self-start"
              onClick={() => setEspesores((es) => [...es, { minMm: "", maxMm: "", aplicacion: "" }])}
            >
              <Plus className="size-3.5" />
              Agregar espesor
            </Button>
          </fieldset>

          <Campo grupo label="Colores de acrílico">
            <Opciones
              valores={colores.map(String)}
              onToggle={(v) =>
                setColores((cs) => (cs.includes(Number(v)) ? cs.filter((c) => c !== Number(v)) : [...cs, Number(v)]))
              }
              opciones={catalogo.colores.map((c) => ({ valor: String(c.id), label: c.nombre }))}
            />
          </Campo>

          {CLASES.map((clase) => (
            <Campo key={clase} grupo label={`${CLASES_OPCION[clase]} que admite`}>
              <Opciones
                valores={[...opciones.keys()].map(String)}
                onToggle={(v) => alternarOpcion(Number(v))}
                opciones={catalogo.opciones
                  .filter((o) => o.clase === clase)
                  .map((o) => ({ valor: String(o.id), label: o.nombre }))}
              />
            </Campo>
          ))}

          {opciones.size > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs font-medium">Lo que el producto trae siempre</legend>
              <p className="text-muted-foreground text-xs">
                Marcadas, llegan ya elegidas al cotizar (una tapa, una ranura). Las demás son opcionales.
              </p>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {catalogo.opciones
                  .filter((o) => opciones.has(o.id))
                  .map((o) => (
                    <label key={o.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={opciones.get(o.id) === false}
                        onChange={(e) => setOpciones((prev) => new Map(prev).set(o.id, !e.target.checked))}
                      />
                      {o.nombre}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button type="button" onClick={guardar} disabled={ocupado || nombre.trim().length < 3 || !tipo}>
            {ocupado ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
