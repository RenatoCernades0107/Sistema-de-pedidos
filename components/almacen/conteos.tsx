"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import type { Conteo, ConteoResumen } from "@/lib/casos";
import { diaEnLima } from "@/lib/fecha";
import { fechaCompleta } from "@/lib/formato";
import type { CategoriaAccesorio } from "@/lib/inventario";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectorAlmacen } from "./comun";
import type { Ingresable } from "./dialogo-ingreso";

const TODOS = "__todos";
const enlace = (codigo: string) => `/almacen?vista=conteos&conteo=${encodeURIComponent(codigo)}`;

/** Los conteos: los que están a medias primero, y empezar uno nuevo. */
export function ListaConteos({
  conteos,
  almacenes,
  materiales,
  categorias,
}: {
  conteos: ConteoResumen[];
  almacenes: Almacen[];
  materiales: string[];
  categorias: CategoriaAccesorio[];
}) {
  const [nuevo, setNuevo] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Cuenta lo que hay en un almacén sin ver lo que dice el sistema. Al enviarlo, cada diferencia queda como un caso
          para Administración.
        </p>
        <Button className="gap-1.5" onClick={() => setNuevo(true)}>
          <ClipboardList className="size-4" />
          Nuevo conteo
        </Button>
      </div>
      {conteos.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">Todavía no hay conteos.</p>
      ) : (
        <ul className="bg-card divide-y rounded-xl border" aria-label="Conteos">
          {conteos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <Link href={enlace(c.codigo)} className="text-primary font-mono text-sm font-semibold hover:underline">
                {c.codigo}
              </Link>
              <span className="text-sm font-medium">{c.almacen}</span>
              <span className="text-muted-foreground text-xs">
                {c.alcance} · {fechaCompleta(diaEnLima(c.creadoEn))}
                {c.creadoPor && ` · ${c.creadoPor}`}
              </span>
              <span className="ml-auto text-xs">
                {c.estado === "borrador"
                  ? `En curso: ${c.contados} de ${c.productos + c.sobrantes} contados`
                  : `Enviado: ${c.diferencias ?? 0} ${c.diferencias === 1 ? "diferencia" : "diferencias"}, ${c.coincidencias ?? 0} coinciden`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {nuevo && <DialogoNuevoConteo almacenes={almacenes} materiales={materiales} categorias={categorias} alCerrar={() => setNuevo(false)} />}
    </div>
  );
}

function DialogoNuevoConteo({
  almacenes,
  materiales,
  categorias,
  alCerrar,
}: {
  almacenes: Almacen[];
  materiales: string[];
  categorias: CategoriaAccesorio[];
  alCerrar: () => void;
}) {
  const router = useRouter();
  const [almacenId, setAlmacenId] = useState<string | null>(null);
  const [planchas, setPlanchas] = useState(true);
  const [material, setMaterial] = useState(TODOS);
  const [accesorios, setAccesorios] = useState(false);
  const [categoria, setCategoria] = useState(TODOS);
  const [sobrantes, setSobrantes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const crear = () => {
    if (!almacenId) return setError("Elige el almacén.");
    iniciar(async () => {
      const r = await acciones.crearConteo({
        almacenId,
        planchas,
        material: material === TODOS ? null : material,
        accesorios,
        categoriaId: categoria === TODOS ? null : categoria,
        sobrantes,
      });
      if (!r.ok) return setError(r.error);
      router.push(enlace(r.codigo!));
      alCerrar();
    });
  };

  const casilla = (etiqueta: string, valor: boolean, cambiar: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={valor} onCheckedChange={(v) => cambiar(v === true)} aria-label={etiqueta} />
      {etiqueta}
    </label>
  );

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo conteo</DialogTitle>
          <DialogDescription>Elige el almacén y qué vas a contar. La lista no dice cuánto debería haber.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Campo grupo label="Almacén" requerido>
            <SelectorAlmacen almacenes={almacenes} valor={almacenId} alCambiar={setAlmacenId} />
          </Campo>
          <div className="flex flex-col gap-2">
            {casilla("Planchas", planchas, setPlanchas)}
            {planchas && (
              <Select value={material} onValueChange={(v) => v && setMaterial(v)}>
                <SelectTrigger aria-label="Material a contar" className="w-full">
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
            )}
            {casilla("Accesorios", accesorios, setAccesorios)}
            {accesorios && (
              <Select value={categoria} onValueChange={(v) => v && setCategoria(v)}>
                <SelectTrigger aria-label="Categoría a contar" className="w-full">
                  <SelectValue>{categoria === TODOS ? "Todas las categorías" : categorias.find((c) => c.id === categoria)?.nombre}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todas las categorías</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {casilla("Sobrantes", sobrantes, setSobrantes)}
          </div>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={crear} disabled={pendiente || !(planchas || accesorios || sobrantes)}>
            {pendiente ? "Armando la lista…" : "Empezar a contar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Contar: un campo por producto, sin lo esperado, y "Está / No está" por
 * sobrante. Se guarda las veces que haga falta; al enviarlo, ya no se cambia.
 */
export function PantallaConteo({ conteo: c, productos }: { conteo: Conteo; productos: Ingresable[] }) {
  const router = useRouter();
  const abierto = c.estado === "borrador";
  const [contados, setContados] = useState<Record<number, string>>(() =>
    Object.fromEntries(c.lineas.map((l) => [l.productoId, l.contado === null ? "" : String(l.contado)])),
  );
  const [encontrados, setEncontrados] = useState<Record<string, boolean | null>>(() =>
    Object.fromEntries(c.sobrantesLista.map((s) => [s.codigo, s.encontrado])),
  );
  const [consulta, setConsulta] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const leer = (t: string) => {
    const v = Number(t.trim());
    return t.trim() === "" ? null : Number.isInteger(v) && v >= 0 ? v : NaN;
  };
  const datos = () => ({
    id: c.id,
    lineas: c.lineas.map((l) => ({ productoId: l.productoId, contado: leer(contados[l.productoId] ?? "") })),
    sobrantes: c.sobrantesLista.map((s) => ({ codigo: s.codigo, encontrado: encontrados[s.codigo] ?? null })),
  });
  const invalidos = c.lineas.filter((l) => Number.isNaN(leer(contados[l.productoId] ?? "")));
  const sinContar =
    c.lineas.filter((l) => leer(contados[l.productoId] ?? "") === null).length +
    c.sobrantesLista.filter((s) => (encontrados[s.codigo] ?? null) === null).length;

  const guardar = () => {
    if (invalidos.length) return setError(`${invalidos[0].codigo}: escribe un número entero.`);
    iniciar(async () => {
      const r = await acciones.guardarConteo(datos());
      if (!r.ok) return setError(r.error);
      toast.success("Conteo guardado", { description: "Puedes seguir después." });
    });
  };

  const enviar = () => {
    if (invalidos.length) return setError(`${invalidos[0].codigo}: escribe un número entero.`);
    if (sinContar > 0 && !confirmar) return setConfirmar(true);
    iniciar(async () => {
      const r = await acciones.enviarConteo(datos());
      if (!r.ok) return setError(r.error);
      toast.success(`${c.codigo} enviado`, { description: r.aviso, duration: 10_000 });
      router.push("/almacen?vista=conteos");
    });
  };

  const anular = () =>
    iniciar(async () => {
      const r = await acciones.anularConteo(c.id);
      if (!r.ok) return setError(r.error);
      router.push("/almacen?vista=conteos");
    });

  const opciones: Opcion[] = useMemo(() => {
    const palabras = consulta.split(/\s+/).map(compactar).filter(Boolean);
    if (palabras.length === 0) return [];
    return productos
      .filter((p) => !c.lineas.some((l) => l.productoId === p.productoId))
      .filter((p) => palabras.every((x) => compactar(`${p.codigo} ${p.titulo}`).includes(x)))
      .slice(0, 10)
      .map((p) => ({
        valor: String(p.productoId),
        alElegir: () => {
          setConsulta("");
          iniciar(async () => {
            // Lo contado hasta ahora se guarda antes: la lista se vuelve a leer.
            const g = await acciones.guardarConteo(datos());
            const r = g.ok ? await acciones.agregarAlConteo(c.id, p.productoId) : g;
            if (!r.ok) setError(r.error);
          });
        },
        contenido: (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{p.codigo}</span>
            <span className="min-w-0 truncate">{p.titulo}</span>
          </span>
        ),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, consulta, c.lineas]);

  const grupos = new Map<string, Conteo["lineas"]>();
  for (const l of c.lineas) grupos.set(l.grupo ?? "Otros", [...(grupos.get(l.grupo ?? "Otros") ?? []), l]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button render={<Link href="/almacen?vista=conteos" />} nativeButton={false} variant="ghost" size="sm" className="gap-1.5">
          <ArrowLeft className="size-3.5" />
          Conteos
        </Button>
        <h2 className="text-base font-semibold">
          {c.codigo} · {c.almacen}
        </h2>
        <span className="text-muted-foreground text-xs">{c.alcance}</span>
        {!abierto && (
          <span className="bg-muted ml-auto rounded-full px-2 py-0.5 text-xs">
            Enviado: {c.diferencias ?? 0} diferencias, {c.coincidencias ?? 0} coinciden
          </span>
        )}
      </div>

      {[...grupos].map(([grupo, lineas]) => (
        <section key={grupo} className="bg-card rounded-xl border" aria-label={grupo}>
          <p className="eyebrow border-b px-4 py-2">{grupo}</p>
          <ul className="divide-y">
            {lineas.map((l) => (
              <li key={l.productoId} className="flex items-center gap-3 px-4 py-2">
                <span className="text-muted-foreground w-20 shrink-0 font-mono text-xs">{l.codigo}</span>
                <span className="min-w-0 flex-1 text-sm">{l.nombre}</span>
                <Input
                  inputMode="numeric"
                  aria-label={`Contaste ${l.codigo}`}
                  placeholder="—"
                  value={contados[l.productoId] ?? ""}
                  onChange={(e) => {
                    setContados((x) => ({ ...x, [l.productoId]: e.target.value }));
                    setError(null);
                    setConfirmar(false);
                  }}
                  disabled={!abierto}
                  className="tnum w-20 text-right"
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {c.sobrantesLista.length > 0 && (
        <section className="bg-card rounded-xl border" aria-label="Sobrantes">
          <p className="eyebrow border-b px-4 py-2">Sobrantes</p>
          <ul className="divide-y">
            {c.sobrantesLista.map((s) => (
              <li key={s.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2" aria-label={s.codigo}>
                <span className="font-mono text-xs">{s.codigo}</span>
                <span className="min-w-0 flex-1 text-sm">
                  {s.material} · {s.medida} cm
                  {s.ubicacion && <span className="text-muted-foreground"> · {s.ubicacion}</span>}
                </span>
                {abierto ? (
                  <Opciones
                    valores={encontrados[s.codigo] === null || encontrados[s.codigo] === undefined ? [] : [encontrados[s.codigo] ? "si" : "no"]}
                    onToggle={(v) => {
                      setEncontrados((x) => ({ ...x, [s.codigo]: v === "si" }));
                      setConfirmar(false);
                    }}
                    opciones={[
                      { valor: "si", label: "Está" },
                      { valor: "no", label: "No está" },
                    ]}
                  />
                ) : (
                  <span className="text-xs">{s.encontrado === null ? "Sin revisar" : s.encontrado ? "Está" : "No está"}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {abierto && (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">¿Encontraste algo que no está en la lista?</p>
            <ComboBusqueda
              etiqueta="Agregar al conteo"
              placeholder="Código o nombre"
              consulta={consulta}
              alEscribir={setConsulta}
              opciones={opciones}
              cargando={false}
              error={null}
              vacio={consulta.trim() ? "Ningún producto del almacén coincide." : "Escribe para buscar."}
              fresco
              enLinea
            />
          </div>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          {confirmar && (
            <p className="bg-st-observado-soft rounded-lg p-3 text-sm" role="alert">
              Quedan {sinContar} sin contar: no se van a comparar. ¿Enviar igual?
            </p>
          )}
          <div className="bg-background sticky bottom-0 flex flex-wrap gap-2 border-t py-3">
            <Button variant="ghost" onClick={anular} disabled={pendiente} className="text-muted-foreground">
              Anular
            </Button>
            <span className="text-muted-foreground ml-auto self-center text-xs">{sinContar} sin contar</span>
            <Button variant="outline" onClick={guardar} disabled={pendiente}>
              Guardar
            </Button>
            <Button onClick={enviar} disabled={pendiente}>
              {confirmar ? "Enviar igual" : "Enviar a revisión"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
