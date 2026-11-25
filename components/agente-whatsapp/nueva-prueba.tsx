"use client";

import { useState, useTransition } from "react";
import { Megaphone, MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { crearPrueba } from "@/app/(app)/agente-whatsapp/acciones";
import type { AnuncioConfigurado } from "@/lib/agente-whatsapp/ajustes";
import type { Anuncio } from "@/lib/agente-whatsapp/tipos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const OTRO = "__otro__";

/**
 * Empieza una conversación de prueba: un mensaje directo, o como si el cliente
 * hubiera tocado "Enviar mensaje" en un anuncio de Meta (Click-to-WhatsApp).
 */
export function NuevaPrueba({
  anuncios,
  alCrear,
}: {
  anuncios: AnuncioConfigurado[];
  alCrear: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [desdeAnuncio, setDesdeAnuncio] = useState(false);
  const [elegido, setElegido] = useState<string>(anuncios[0]?.sourceId ?? OTRO);
  const [libre, setLibre] = useState<Anuncio>({ titulo: "", texto: "", sourceId: "" });
  const [creando, iniciar] = useTransition();

  const anuncio: Anuncio | null = !desdeAnuncio
    ? null
    : elegido === OTRO
      ? libre
      : { sourceId: elegido, titulo: anuncios.find((a) => a.sourceId === elegido)?.nombre };
  const valido = !desdeAnuncio || Boolean(anuncio?.sourceId?.trim() || anuncio?.titulo?.trim() || anuncio?.texto?.trim());

  const crear = () =>
    iniciar(async () => {
      const r = await crearPrueba({ anuncio });
      if (!r.ok) {
        toast.error("No se creó la prueba", { description: r.error });
        return;
      }
      setAbierto(false);
      alCrear(r.id);
    });

  return (
    <>
      <Button className="w-full" onClick={() => setAbierto(true)}>
        <Plus data-icon="inline-start" />
        Nueva prueba
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva conversación de prueba</DialogTitle>
            <DialogDescription>
              Escribes tú como si fueras el cliente. Nada se envía a WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cómo llega el cliente">
            {[
              { valor: false, icono: MessageCircle, titulo: "Mensaje directo", texto: "Escribe al número de la empresa." },
              { valor: true, icono: Megaphone, titulo: "Desde un anuncio", texto: "Tocó «Enviar mensaje» en un anuncio de Meta." },
            ].map((o) => (
              <button
                key={o.titulo}
                type="button"
                role="radio"
                aria-checked={desdeAnuncio === o.valor}
                onClick={() => setDesdeAnuncio(o.valor)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors",
                  desdeAnuncio === o.valor ? "border-primary bg-primary/5" : "hover:bg-muted",
                )}
              >
                <o.icono className="text-muted-foreground size-4" aria-hidden />
                <span className="font-medium">{o.titulo}</span>
                <span className="text-muted-foreground text-xs">{o.texto}</span>
              </button>
            ))}
          </div>

          {desdeAnuncio && (
            <div className="flex flex-col gap-3">
              <Campo label="Anuncio">
                <Select value={elegido} onValueChange={(v) => v && setElegido(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {elegido === OTRO ? "Otro anuncio (escribirlo)" : anuncios.find((a) => a.sourceId === elegido)?.nombre}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {anuncios.map((a) => (
                      <SelectItem key={a.sourceId} value={a.sourceId}>
                        {a.nombre}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTRO}>Otro anuncio (escribirlo)</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              {elegido === OTRO && (
                <>
                  <Campo label="Titular del anuncio" ayuda="Lo que trae Meta como «headline».">
                    <Input
                      value={libre.titulo}
                      placeholder="Planchas de acrílico a precio de fábrica"
                      onChange={(e) => setLibre((l) => ({ ...l, titulo: e.target.value }))}
                    />
                  </Campo>
                  <Campo label="Texto del anuncio">
                    <Textarea
                      rows={3}
                      value={libre.texto}
                      placeholder="Acrílico cristal y de colores en todos los espesores. ¡Escríbenos!"
                      onChange={(e) => setLibre((l) => ({ ...l, texto: e.target.value }))}
                    />
                  </Campo>
                  <Campo label="ID del anuncio (opcional)" ayuda="Si coincide con uno de Ajustes, el agente usa su contexto.">
                    <Input
                      value={libre.sourceId}
                      inputMode="numeric"
                      onChange={(e) => setLibre((l) => ({ ...l, sourceId: e.target.value }))}
                    />
                  </Campo>
                </>
              )}
              {anuncios.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Puedes guardar tus anuncios con su contexto en la pestaña Ajustes para elegirlos aquí.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={crear} disabled={creando || !valido}>
              {creando ? "Creando…" : "Empezar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
