"use client";

/**
 * El campo de texto del chat con referencias @.
 *
 * Se escribe `@` y se abre un menú con los tipos (cliente, pedido, plancha,
 * diseño 3D, usuario); lo que sigue a la arroba los filtra (`@pe` → Pedido) y
 * también se pueden escribir los comandos enteros (`@pedido P2611`, `@cliente
 * 9876`): lo que va después del comando es la consulta, con resultados en vivo.
 * Algunos tipos se recorren por niveles (plancha: material › color › espesor ›
 * formato; diseño: cliente › pedido › ítem). Elegir cambia el comando por una
 * ficha.
 *
 * **Encadenar**: si justo antes del `@` (solo espacios en medio) hay fichas de
 * un cliente y/o un pedido, el menú busca desde ahí: "Pedidos de Juan Pérez",
 * "Diseños del pedido P2611-001". La referencia elegida guarda ese contexto.
 *
 * El texto guardado lleva `@r1`, pero el cuadro muestra `@Juan Pérez` (ver
 * `lib/chat/referencias.ts`, "la pantalla"); una capa detrás del cuadro pinta
 * las fichas con el color de su tipo, como el chat de diseños con sus caras.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  aGuardado,
  aliasLibre,
  aPantalla,
  comandoEnCurso,
  contextoEncadenado,
  editar,
  insertarFicha,
  NIVEL_RAIZ,
  referenciasDe,
  reemplazar,
  sugerenciasDeContexto,
  textoDeComando,
  tiposQueEmpiezan,
  usaContexto,
  type NivelReferencia,
  type OpcionReferencia,
  type Pantalla,
} from "@/lib/chat/referencias";
import type { Referencia, TipoReferencia } from "@/lib/chat/tipos";
import { MAX_TEXTO, TIPOS_REFERENCIA, referenciasUsadas } from "@/lib/chat/tipos";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { FONDO_CAMPO, ICONO_MENU, ICONO_REFERENCIA } from "./estilos";
import { useOpcionesReferencia } from "./use-opciones";

export interface PropsCampoConReferencias {
  /** El texto con las fichas `@rN`. */
  valor: string;
  /** Las referencias de las fichas del texto. */
  referencias: Referencia[];
  /** Cada cambio del texto o de las referencias (ya filtradas a las que siguen en el texto). */
  onCambio: (texto: string, referencias: Referencia[]) => void;
  /** Enter sin Shift, con el menú de @ cerrado. */
  onEnviar: () => void;
  /** Para pegar archivos (Ctrl+V de una captura) en el compositor. */
  onPegarArchivos?: (archivos: File[]) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Va al `<textarea>`. Que no cambie el padding ni la letra: la capa de las fichas los copia, pero mejor no tentar. */
  className?: string;
  /**
   * El `<textarea>`. Ojo: su `value` es lo que se ve (`@Juan Pérez`), no lo guardado
   * (`@r1`). Para escribir en el campo, usa `valor`/`onCambio`.
   */
  ref?: Ref<HTMLTextAreaElement>;
  /** Hacia dónde se abre el menú de @. Arriba por defecto: el compositor va al pie. */
  ladoMenu?: "arriba" | "abajo";
}

/** Una fila del menú: un tipo para elegir o una opción del buscador. */
type Fila =
  | { clase: "tipo"; clave: string; tipo: TipoReferencia; texto: string; ayuda: string }
  | { clase: "opcion"; clave: string; tipo: TipoReferencia; opcion: OpcionReferencia };

/** Las propiedades de la letra y la caja que la capa copia del textarea para que el texto calce. */
const ESTILOS_COPIADOS = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "tabSize",
] as const;

export function CampoConReferencias({
  valor,
  referencias,
  onCambio,
  onEnviar,
  onPegarArchivos,
  placeholder = "Escribe un mensaje… (@ para referenciar)",
  disabled,
  autoFocus,
  className,
  ref,
  ladoMenu = "arriba",
}: PropsCampoConReferencias) {
  const idBase = useId();
  const idLista = `${idBase}-lista`;
  const area = useRef<HTMLTextAreaElement | null>(null);
  const capa = useRef<HTMLDivElement>(null);

  const pantalla = useMemo(() => aPantalla(valor, referencias), [valor, referencias]);

  /** Dónde está el caret (sin selección). `null` si no hay foco: el menú no se abre. */
  const [cursor, setCursor] = useState<number | null>(null);
  /** La arroba cuyo menú se cerró con Esc: no se vuelve a abrir mientras siga ahí. */
  const [cerradoEn, setCerradoEn] = useState<number | null>(null);
  /** Los niveles recorridos en el menú, de esa arroba y ese tipo. */
  const [pila, setPila] = useState<{ clave: string; niveles: NivelReferencia[] }>({ clave: "", niveles: [] });
  const [activa, setActiva] = useState<{ clave: string; indice: number }>({ clave: "", indice: 0 });
  /** El caret que hay que poner cuando el texto nuevo llegue de vuelta en `valor`. */
  const caretPendiente = useRef<number | null>(null);

  const comando = cursor === null || disabled ? null : comandoEnCurso(pantalla, cursor);
  const visible = comando !== null && comando.inicio !== cerradoEn;
  const contexto = useMemo(
    () => (comando ? contextoEncadenado(pantalla, comando.inicio) : []),
    // El contexto solo cambia con la arroba o el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pantalla, comando?.inicio],
  );

  const clavePila = comando?.modo === "buscar" ? `${comando.inicio}:${comando.tipo}` : "";
  const niveles = pila.clave === clavePila ? pila.niveles : [];
  const nivel = niveles.at(-1) ?? NIVEL_RAIZ;

  const peticion =
    visible && comando.modo === "buscar"
      ? {
          tipo: comando.tipo,
          consulta: comando.consulta,
          contexto: usaContexto(comando.tipo, contexto) ? contexto : [],
          nivel,
        }
      : null;
  const { respuesta, error, cargando } = useOpcionesReferencia(peticion);

  // ── Las filas del menú ────────────────────────────────────────────────────
  const filas: Fila[] = [];
  if (visible && comando.modo === "tipos") {
    const filtrados = tiposQueEmpiezan(comando.filtro);
    if (!comando.filtro) {
      for (const s of sugerenciasDeContexto(contexto)) {
        filas.push({ clase: "tipo", clave: `s:${s.tipo}`, tipo: s.tipo, texto: s.texto, ayuda: "" });
      }
    }
    for (const t of filtrados) {
      filas.push({ clase: "tipo", clave: `t:${t}`, tipo: t, texto: TIPOS_REFERENCIA[t].nombre, ayuda: TIPOS_REFERENCIA[t].ayuda });
    }
  } else if (visible && comando.modo === "buscar") {
    for (const o of respuesta?.opciones ?? []) {
      filas.push({ clase: "opcion", clave: o.clave, tipo: comando.tipo, opcion: o });
    }
  }
  const abierto = visible && (comando.modo === "buscar" || filas.length > 0);

  const claveLista = abierto ? `${clavePila || comando.inicio}|${niveles.length}|${filas.map((f) => f.clave).join(",")}` : "";
  const indiceActivo = activa.clave === claveLista ? Math.min(activa.indice, Math.max(filas.length - 1, 0)) : 0;
  const filaActiva = abierto ? filas[indiceActivo] : undefined;
  const idOpcion = (i: number) => `${idBase}-op-${i}`;

  // ── Cambiar el texto ──────────────────────────────────────────────────────
  const cambiar = (nueva: Pantalla, caret: number) => {
    const guardado = aGuardado(nueva);
    // El tope es del texto guardado (`@r1` es más corto que `@Juan Pérez`).
    if (guardado.length > MAX_TEXTO) return;
    caretPendiente.current = caret;
    setCursor(caret);
    // Un Esc vale para esa arroba: si se borró, la próxima vuelve a abrir el menú.
    if (cerradoEn !== null && comandoEnCurso(nueva, caret)?.inicio !== cerradoEn) setCerradoEn(null);
    onCambio(guardado, referenciasUsadas(guardado, referenciasDe(nueva)));
  };

  // El caret vuelve a su lugar cuando el texto cambió por algo que no fue una tecla.
  useLayoutEffect(() => {
    const el = area.current;
    const c = caretPendiente.current;
    caretPendiente.current = null;
    if (el && c !== null && document.activeElement === el && (el.selectionStart !== c || el.selectionEnd !== c)) {
      el.setSelectionRange(c, c);
    }
  }, [valor]);

  // La capa copia la letra y el padding del textarea: así calza aunque cambie el `className`.
  useLayoutEffect(() => {
    const el = area.current;
    const c = capa.current;
    if (!el || !c) return;
    const estilo = getComputedStyle(el);
    for (const p of ESTILOS_COPIADOS) c.style[p] = estilo[p];
  }, [className, pantalla.fichas.length]);

  // La fila activa siempre a la vista.
  useEffect(() => {
    if (abierto) document.getElementById(idOpcion(indiceActivo))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, indiceActivo, claveLista]);

  const elegirTipo = (tipo: TipoReferencia) => {
    if (!comando) return;
    const texto = textoDeComando(tipo);
    cambiar(reemplazar(pantalla, comando.inicio, comando.fin, texto), comando.inicio + texto.length);
  };

  const bajar = (destino: NivelReferencia) => {
    if (!comando || comando.modo !== "buscar") return;
    setPila({ clave: clavePila, niveles: [...niveles, destino] });
    // Lo escrito servía para encontrar la fila; en el nivel nuevo se empieza de cero.
    if (comando.consulta) {
      const desde = comando.fin - comando.consulta.length;
      cambiar(reemplazar(pantalla, desde, comando.fin, ""), desde);
    }
  };

  const subir = () => setPila({ clave: clavePila, niveles: niveles.slice(0, -1) });

  const elegirOpcion = (o: OpcionReferencia) => {
    if (!comando) return;
    if (!o.referencia) {
      if (o.navegable) bajar(o.navegable);
      return;
    }
    const referencia: Referencia = { ...o.referencia, alias: aliasLibre(valor, referencias) };
    const { pantalla: nueva, cursor: caret } = insertarFicha(pantalla, comando.inicio, comando.fin, referencia);
    setPila({ clave: "", niveles: [] });
    cambiar(nueva, caret);
  };

  const elegir = (f: Fila | undefined) => {
    if (!f) return;
    if (f.clase === "tipo") elegirTipo(f.tipo);
    else elegirOpcion(f.opcion);
  };

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (abierto && comando) {
      const n = filas.length;
      const mover = (indice: number) => setActiva({ clave: claveLista, indice });
      switch (e.key) {
        case "ArrowDown":
          if (n) {
            e.preventDefault();
            mover((indiceActivo + 1) % n);
          }
          return;
        case "ArrowUp":
          if (n) {
            e.preventDefault();
            mover((indiceActivo - 1 + n) % n);
          }
          return;
        case "Enter":
        case "Tab":
          if (e.shiftKey) break;
          // Con el menú abierto, Enter elige; nunca envía un "@pedido P26" a medias.
          e.preventDefault();
          elegir(filaActiva);
          return;
        case "ArrowRight":
          if (filaActiva?.clase === "opcion" && filaActiva.opcion.navegable) {
            e.preventDefault();
            bajar(filaActiva.opcion.navegable);
          }
          return;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          setCerradoEn(comando.inicio);
          return;
        case "Backspace":
          // Sin nada escrito tras el comando, Backspace vuelve un nivel antes de borrar.
          if (comando.modo === "buscar" && !comando.consulta && niveles.length) {
            e.preventDefault();
            subir();
          }
          return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnviar();
    }
  };

  // ── Lo que dice la cabecera del menú ──────────────────────────────────────
  const cabecera = (() => {
    if (!comando) return null;
    if (comando.modo === "tipos") {
      const desde = contexto.at(-1);
      return desde ? `Referenciar desde ${desde.etiqueta}` : "Referenciar";
    }
    const nombre = TIPOS_REFERENCIA[comando.tipo].nombre;
    if (nivel.migas.length) return [nombre, ...nivel.migas].join(" › ");
    return respuesta?.titulo ?? nombre;
  })();

  const mensajeVacio = (() => {
    if (!comando || comando.modo !== "buscar") return null;
    if (error) return error;
    if (cargando && !respuesta) return "Buscando…";
    if (respuesta && !respuesta.opciones.length) {
      return respuesta.aviso ?? (comando.consulta ? `Nada con “${comando.consulta.trim()}”.` : "No hay nada aquí todavía.");
    }
    return null;
  })();

  const anunciado = !abierto
    ? ""
    : comando.modo === "buscar" && cargando
      ? "Buscando"
      : `${filas.length} ${filas.length === 1 ? "opción" : "opciones"}`;

  return (
    <div className="relative min-w-0 flex-1">
      {abierto && (
        <div
          className={cn(
            "absolute inset-x-0 z-50 flex max-h-80 flex-col overflow-hidden rounded-lg bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
            ladoMenu === "arriba" ? "bottom-full mb-2" : "top-full mt-2",
          )}
          // Tocar el menú no le quita el foco al cuadro: el caret sigue donde estaba.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex min-h-9 items-center gap-1 border-b px-2 py-1">
            {niveles.length > 0 && (
              <button
                type="button"
                onClick={subir}
                aria-label="Volver al nivel anterior"
                className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
            {comando.modo === "buscar" && (() => {
              const Icono = ICONO_REFERENCIA[comando.tipo];
              return <Icono className={cn("size-4 shrink-0", ICONO_MENU[comando.tipo])} aria-hidden />;
            })()}
            <span className="min-w-0 flex-1 truncate font-medium">{cabecera}</span>
            {comando.modo === "buscar" && cargando && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            )}
            {comando.modo === "buscar" && !comando.consulta && !nivel.migas.length && (
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {TIPOS_REFERENCIA[comando.tipo].ayuda}
              </span>
            )}
          </div>

          {respuesta?.aviso && respuesta.opciones.length > 0 && (
            <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{respuesta.aviso}</p>
          )}

          <ul id={idLista} role="listbox" aria-label={cabecera ?? "Referencias"} className="min-h-0 flex-1 overflow-y-auto p-1">
            {filas.map((f, i) => {
              const Icono = ICONO_REFERENCIA[f.tipo];
              const activaAqui = i === indiceActivo;
              const o = f.clase === "opcion" ? f.opcion : null;
              const soloNavega = o && !o.referencia;
              return (
                <li
                  key={f.clave}
                  id={idOpcion(i)}
                  role="option"
                  aria-selected={activaAqui}
                  onMouseMove={() => !activaAqui && setActiva({ clave: claveLista, indice: i })}
                  onClick={() => elegir(f)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 sm:min-h-9",
                    activaAqui && "bg-accent text-accent-foreground",
                  )}
                >
                  {o?.miniatura ? (
                    // Las fotos de los diseños son del bucket público: un <img> basta.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.miniatura} alt="" className="size-8 shrink-0 rounded border bg-muted object-contain" />
                  ) : (
                    <Icono className={cn("size-4 shrink-0", ICONO_MENU[f.tipo])} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{f.clase === "tipo" ? f.texto : f.opcion.etiqueta}</span>
                    {(f.clase === "tipo" ? f.ayuda : f.opcion.detalle) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {f.clase === "tipo" ? f.ayuda : f.opcion.detalle}
                      </span>
                    )}
                  </span>
                  {f.clase === "tipo" && <span className="shrink-0 text-xs text-muted-foreground">@{TIPOS_REFERENCIA[f.tipo].comando}</span>}
                  {o?.navegable &&
                    (soloNavega ? (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      // Se puede elegir la fila o entrar a ella (el espesor de una plancha → sus formatos).
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Ver dentro de ${o.etiqueta}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          bajar(o.navegable!);
                        }}
                        className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    ))}
                </li>
              );
            })}
            {mensajeVacio && filas.length === 0 && (
              <li role="presentation" className="px-2 py-3 text-center text-sm text-muted-foreground">
                {mensajeVacio}
              </li>
            )}
          </ul>

          <p className="hidden border-t px-3 py-1 text-[11px] text-muted-foreground sm:block">
            ↑↓ para moverte · Enter elige{filaActiva?.clase === "opcion" && filaActiva.opcion.navegable ? " · → entra" : ""}
            {niveles.length ? " · ⌫ vuelve" : ""} · Esc cierra
          </p>
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {anunciado}
      </span>

      {pantalla.fichas.length > 0 && (
        <div
          ref={capa}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent px-2.5 py-2 text-base break-words whitespace-pre-wrap text-transparent md:text-sm"
        >
          {trozosDeCapa(pantalla).map((t, i) =>
            typeof t === "string" ? (
              <span key={i}>{t}</span>
            ) : (
              <mark key={i} className={cn("rounded-sm text-transparent", FONDO_CAMPO[t.tipo])}>
                {t.texto}
              </mark>
            ),
          )}
          {/* Un salto final como el del textarea, para que las alturas coincidan. */}
          {"​"}
        </div>
      )}

      <Textarea
        ref={(el) => {
          area.current = el;
          if (typeof ref === "function") return ref(el);
          if (ref) ref.current = el;
        }}
        rows={1}
        value={pantalla.texto}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          const el = e.currentTarget;
          const r = editar(pantalla, el.value, el.selectionEnd);
          cambiar(r.pantalla, r.cursor);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          setCursor(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
        }}
        onFocus={(e) => setCursor(e.currentTarget.selectionStart)}
        onBlur={() => setCursor(null)}
        onScroll={(e) => {
          if (capa.current) capa.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onPaste={(e) => {
          const archivos = [...e.clipboardData.files];
          if (archivos.length && onPegarArchivos) {
            e.preventDefault();
            onPegarArchivos(archivos);
          }
        }}
        onKeyDown={alTeclear}
        placeholder={placeholder}
        aria-label="Mensaje"
        aria-autocomplete="list"
        aria-controls={abierto ? idLista : undefined}
        aria-activedescendant={abierto && filaActiva ? idOpcion(indiceActivo) : undefined}
        className={cn(
          // Sin barra de desplazamiento: le quitaría ancho al texto y la capa de atrás no calzaría.
          "relative max-h-40 min-h-9 resize-none bg-transparent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      />
    </div>
  );
}

/** El texto de la capa: trozos sueltos y las fichas con su tipo. */
function trozosDeCapa(p: Pantalla): (string | { tipo: TipoReferencia; texto: string })[] {
  const trozos: (string | { tipo: TipoReferencia; texto: string })[] = [];
  let desde = 0;
  for (const f of p.fichas) {
    if (f.inicio > desde) trozos.push(p.texto.slice(desde, f.inicio));
    trozos.push({ tipo: f.referencia.tipo, texto: p.texto.slice(f.inicio, f.fin) });
    desde = f.fin;
  }
  if (desde < p.texto.length) trozos.push(p.texto.slice(desde));
  return trozos;
}
