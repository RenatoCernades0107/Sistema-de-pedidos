"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Landmark, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { agregarCuentaBancaria, mostrarCuentaEnPdf, retirarCuentaBancaria } from "@/app/(app)/configuracion/cuentas-acciones";
import {
  MONEDAS_CUENTA,
  TIPOS_CUENTA,
  esquemaCuentaBancaria,
  estadoCuenta,
  tituloCuenta,
  type CuentaBancaria,
  type MonedaCuenta,
  type TipoCuenta,
} from "@/lib/cuentas-bancarias";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const enLima = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const cuando = (iso: string) => enLima.format(new Date(iso));

/**
 * Las cuentas para depósito del PDF de la cotización. No hay "editar": para
 * corregir un número se agrega la cuenta buena y se retira la mala. Cada cambio
 * pide la contraseña, y una cuenta nueva tarda 24 horas en salir en los PDF.
 */
export function CuentasBancarias({ cuentas }: { cuentas: CuentaBancaria[] }) {
  const [agregando, setAgregando] = useState(false);
  const [retirando, setRetirando] = useState<CuentaBancaria | null>(null);
  const [verRetiradas, setVerRetiradas] = useState(false);

  const activas = cuentas.filter((c) => !c.retiradaEn);
  const retiradas = cuentas.filter((c) => c.retiradaEn);
  const pendientes = activas.filter((c) => estadoCuenta(c) === "pendiente");

  return (
    <section className="bg-card max-w-3xl rounded-xl border">
      <header className="bg-muted/40 flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">Cuentas para depósito</h2>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            Salen al pie del PDF de cada cotización las que tengan marcada la casilla «Mostrar en el PDF». Por seguridad, una cuenta no se edita: si hay un error, agrega la
            correcta y retira la otra. Una cuenta nueva aparece en las cotizaciones 24 horas después de agregada, y
            solo en las que se emitan desde entonces.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setAgregando(true)}>
          <Plus className="size-3.5" />
          Agregar cuenta
        </Button>
      </header>

      {pendientes.length > 0 && (
        <div className="flex gap-2 border-b bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            {pendientes.length === 1 ? "Hay una cuenta nueva en espera." : `Hay ${pendientes.length} cuentas nuevas en espera.`}{" "}
            Revisa que la hayas agregado tú o alguien de confianza. Si no la reconoces, retírala ahora y cambia las
            contraseñas de Administración.
          </p>
        </div>
      )}

      {activas.length === 0 ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-sm">
          Todavía no hay cuentas: el PDF sale sin datos de pago.
        </p>
      ) : (
        <ul className="divide-y">
          {activas.map((c) => (
            <FilaCuenta key={c.id} cuenta={c} alRetirar={() => setRetirando(c)} />
          ))}
        </ul>
      )}

      {retiradas.length > 0 && (
        <div className="border-t px-4 py-3">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
            onClick={() => setVerRetiradas((v) => !v)}
          >
            {verRetiradas ? "Ocultar" : "Ver"} historial de cuentas retiradas ({retiradas.length})
          </button>
          {verRetiradas && (
            <ul className="mt-2 divide-y opacity-75">
              {retiradas.map((c) => (
                <FilaCuenta key={c.id} cuenta={c} />
              ))}
            </ul>
          )}
        </div>
      )}

      <DialogoAgregar abierto={agregando} alCerrar={() => setAgregando(false)} />
      <DialogoRetirar cuenta={retirando} alCerrar={() => setRetirando(null)} />
    </section>
  );
}

function FilaCuenta({ cuenta: c, alRetirar }: { cuenta: CuentaBancaria; alRetirar?: () => void }) {
  const router = useRouter();
  const [cambiando, iniciar] = useTransition();
  const estado = estadoCuenta(c);

  const mostrar = (mostrar: boolean) =>
    iniciar(async () => {
      const r = await mostrarCuentaEnPdf({ id: c.id, mostrar });
      if (!r.ok) {
        toast.error("No se cambió la cuenta", { description: r.error });
        return;
      }
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <Landmark className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{tituloCuenta(c)}</span>
          {estado === "vigente" && (c.enPdf ? <Badge variant="secondary">En las cotizaciones</Badge> : <Badge variant="outline">Oculta en el PDF</Badge>)}
          {estado === "pendiente" && (
            <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200">Desde {cuando(c.vigenteDesde)}</Badge>
          )}
          {estado === "retirada" && <Badge variant="outline">Retirada</Badge>}
        </div>
        <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground text-xs leading-5">N.° de cuenta</dt>
          <dd className="tnum font-mono text-[13px] break-all select-all">{c.numero}</dd>
          <dt className="text-muted-foreground text-xs leading-5">CCI</dt>
          <dd className="tnum font-mono text-[13px] break-all select-all">{c.cci ?? "—"}</dd>
        </dl>
        <p className="text-muted-foreground mt-1 text-xs">
          Agregada por {c.creadaPor} el {cuando(c.creadaEn)}
          {c.retiradaEn && ` · Retirada por ${c.retiradaPor} el ${cuando(c.retiradaEn)}`}
        </p>
      </div>
      {alRetirar && (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={c.enPdf} disabled={cambiando} onCheckedChange={(v) => mostrar(v === true)} />
          Mostrar en el PDF
        </label>
      )}
      {alRetirar && (
        <Button variant="outline" size="sm" onClick={alRetirar}>
          {estado === "pendiente" ? "Cancelar" : "Retirar"}
        </Button>
      )}
    </li>
  );
}

/** La contraseña con que se confirma cada cambio. */
function CampoPassword({ valor, cambiar }: { valor: string; cambiar: (v: string) => void }) {
  return (
    <Campo label="Tu contraseña" ayuda="Se pide en cada cambio de cuentas, aunque ya tengas la sesión abierta.">
      <Input type="password" autoComplete="current-password" value={valor} onChange={(e) => cambiar(e.target.value)} />
    </Campo>
  );
}

const VACIA = { banco: "", tipo: "" as TipoCuenta | "", moneda: "" as MonedaCuenta | "", numero: "", cci: "" };

function DialogoAgregar({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const router = useRouter();
  const [datos, setDatos] = useState(VACIA);
  const [password, setPassword] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [guardando, iniciar] = useTransition();

  const validacion = esquemaCuentaBancaria.safeParse(datos);
  const errorDe = (campo: keyof typeof VACIA) =>
    intentado && !validacion.success
      ? validacion.error.issues.find((i) => i.path[0] === campo)?.message
      : undefined;

  const cerrar = () => {
    setDatos(VACIA);
    setPassword("");
    setIntentado(false);
    alCerrar();
  };

  const guardar = () => {
    setIntentado(true);
    if (!validacion.success || !password) return;
    iniciar(async () => {
      const r = await agregarCuentaBancaria({ cuenta: datos, password });
      if (!r.ok) {
        toast.error("No se agregó la cuenta", { description: r.error });
        return;
      }
      toast.success("Cuenta agregada", {
        description: "Saldrá en las cotizaciones dentro de 24 horas. Se avisó a Administración.",
      });
      cerrar();
      router.refresh();
    });
  };

  const poner = <K extends keyof typeof VACIA>(k: K, v: (typeof VACIA)[K]) => setDatos((d) => ({ ...d, [k]: v }));

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar cuenta para depósito</DialogTitle>
          <DialogDescription>
            Cópiala del estado de cuenta o de la banca por internet, no de un mensaje. Una vez guardada no se puede
            editar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <Campo label="Banco" requerido error={errorDe("banco")}>
            <Input
              value={datos.banco}
              onChange={(e) => poner("banco", e.target.value)}
              placeholder="BCP, Interbank, BBVA, Scotiabank, Banco de la Nación…"
              maxLength={60}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Tipo de cuenta" requerido error={errorDe("tipo")}>
              <Select value={datos.tipo || null} onValueChange={(v) => v && poner("tipo", v as TipoCuenta)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{datos.tipo ? TIPOS_CUENTA[datos.tipo] : "Elige…"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPOS_CUENTA).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Moneda" requerido error={errorDe("moneda")}>
              <Select value={datos.moneda || null} onValueChange={(v) => v && poner("moneda", v as MonedaCuenta)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{datos.moneda ? MONEDAS_CUENTA[datos.moneda] : "Elige…"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MONEDAS_CUENTA).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
          <Campo label="N.° de cuenta" requerido error={errorDe("numero")}>
            <Input
              value={datos.numero}
              onChange={(e) => poner("numero", e.target.value)}
              placeholder="191-1234567-0-12"
              inputMode="numeric"
              autoComplete="off"
              className="tnum font-mono"
              maxLength={40}
            />
          </Campo>
          <Campo
            label="CCI"
            requerido={datos.tipo !== "detracciones"}
            ayuda="Los 20 dígitos del código interbancario."
            error={errorDe("cci")}
          >
            <Input
              value={datos.cci}
              onChange={(e) => poner("cci", e.target.value)}
              placeholder="00219100123456701252"
              inputMode="numeric"
              autoComplete="off"
              className="tnum font-mono"
              maxLength={30}
            />
          </Campo>
          <CampoPassword valor={password} cambiar={setPassword} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" className="gap-1.5" disabled={guardando || !password}>
              <ShieldCheck className="size-4" />
              {guardando ? "Comprobando…" : "Agregar cuenta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoRetirar({ cuenta, alCerrar }: { cuenta: CuentaBancaria | null; alCerrar: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [guardando, iniciar] = useTransition();

  const cerrar = () => {
    setPassword("");
    alCerrar();
  };

  const retirar = () => {
    if (!cuenta || !password) return;
    iniciar(async () => {
      const r = await retirarCuentaBancaria({ id: cuenta.id, password });
      if (!r.ok) {
        toast.error("No se retiró la cuenta", { description: r.error });
        return;
      }
      toast.success("Cuenta retirada", { description: "Ya no sale en ninguna cotización." });
      cerrar();
      router.refresh();
    });
  };

  return (
    <Dialog open={cuenta !== null} onOpenChange={(v) => !v && cerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirar cuenta</DialogTitle>
          <DialogDescription>
            {cuenta && `${tituloCuenta(cuenta)}, N.° ${cuenta.numero}. `}
            Deja de salir en todas las cotizaciones, también en las ya enviadas. No se puede deshacer: para volver a
            usarla hay que agregarla otra vez (y esperar 24 horas).
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            retirar();
          }}
        >
          <CampoPassword valor={password} cambiar={setPassword} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={guardando || !password}>
              {guardando ? "Comprobando…" : "Retirar cuenta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
