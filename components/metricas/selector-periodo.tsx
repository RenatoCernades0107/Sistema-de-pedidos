"use client";

import { CalendarRange } from "lucide-react";
import { PERIODOS, type ClavePeriodo, type Periodo } from "@/lib/metricas";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * El único filtro del dashboard, arriba de todo: todas las pestañas miran el mismo
 * período. "Personalizado" abre dos fechas; el resto se resuelve solo.
 */
export function SelectorPeriodo({
  periodo,
  hoy,
  onCambiar,
}: {
  periodo: Periodo;
  hoy: string;
  onCambiar: (cambio: { p: ClavePeriodo; desde?: string; hasta?: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={periodo.clave}
        onValueChange={(v) => {
          const p = (v as ClavePeriodo) ?? "mes";
          // Al abrir el personalizado se parte del período que se estaba viendo.
          onCambiar(p === "rango" ? { p, desde: periodo.desde, hasta: periodo.hasta } : { p });
        }}
      >
        <SelectTrigger className="w-auto min-w-[10.5rem]" aria-label="Período">
          <CalendarRange className="text-muted-foreground size-3.5" />
          <SelectValue>{PERIODOS[periodo.clave]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PERIODOS) as ClavePeriodo[]).map((c) => (
            <SelectItem key={c} value={c}>
              {PERIODOS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {periodo.clave === "rango" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={periodo.desde}
            max={hoy}
            onChange={(e) => e.target.value && onCambiar({ p: "rango", desde: e.target.value, hasta: periodo.hasta })}
            className="h-8 w-auto"
            aria-label="Desde"
          />
          <span className="text-muted-foreground text-sm">a</span>
          <Input
            type="date"
            value={periodo.hasta}
            max={hoy}
            onChange={(e) => e.target.value && onCambiar({ p: "rango", desde: periodo.desde, hasta: e.target.value })}
            className="h-8 w-auto"
            aria-label="Hasta"
          />
        </div>
      )}
    </div>
  );
}
