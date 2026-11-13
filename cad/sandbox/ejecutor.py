"""
Lanza `trabajador.py` en un proceso hijo con límites y recoge su resultado.

Límites (configurables por entorno, ver README):
  CAD_SANDBOX_TIEMPO_S      tiempo de reloj máximo (por defecto 60 s; se mata el grupo)
  CAD_SANDBOX_CPU_S         tiempo de CPU (RLIMIT_CPU, por defecto 45 s)
  CAD_SANDBOX_MEMORIA_MB    espacio de direcciones (RLIMIT_AS, por defecto 3072 MB)
  CAD_SANDBOX_ARCHIVO_MB    tamaño máximo de archivo escrito (RLIMIT_FSIZE, 64 MB)
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from typing import Any

from .verificador import revisar

ES_WINDOWS = os.name == "nt"

TRABAJADOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trabajador.py")
MAX_RESULTADO = 48 * 1024 * 1024
MAX_SALIDA_BIN = 48 * 1024 * 1024


def _entero_entorno(nombre: str, defecto: int) -> int:
    try:
        return max(1, int(os.environ.get(nombre, defecto)))
    except ValueError:
        return defecto


@dataclass
class Limites:
    tiempo_s: int = field(default_factory=lambda: _entero_entorno("CAD_SANDBOX_TIEMPO_S", 60))
    cpu_s: int = field(default_factory=lambda: _entero_entorno("CAD_SANDBOX_CPU_S", 45))
    memoria_mb: int = field(default_factory=lambda: _entero_entorno("CAD_SANDBOX_MEMORIA_MB", 3072))
    archivo_mb: int = field(default_factory=lambda: _entero_entorno("CAD_SANDBOX_ARCHIVO_MB", 64))


@dataclass
class Resultado:
    ok: bool
    datos: dict[str, Any]
    binario: bytes | None = None

    @property
    def error(self) -> dict[str, Any]:
        return self.datos.get("error") or {}


def _preparar_hijo(limites: Limites):
    def preparar() -> None:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (limites.cpu_s, limites.cpu_s + 1))
        memoria = limites.memoria_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memoria, memoria))
        archivo = limites.archivo_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_FSIZE, (archivo, archivo))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
        os.umask(0o077)

    return preparar


def _entorno_hijo() -> dict[str, str]:
    """Entorno mínimo. En Windows Python no arranca sin SYSTEMROOT; no es una credencial."""
    if ES_WINDOWS:
        return {k: os.environ[k] for k in ("SYSTEMROOT", "SYSTEMDRIVE") if k in os.environ}
    return {}


def _matar_grupo(proceso: subprocess.Popen) -> None:
    if not ES_WINDOWS:
        try:
            os.killpg(proceso.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        proceso.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _leer_cola(ruta: str, maximo: int = 2000) -> str:
    try:
        with open(ruta, "rb") as f:
            f.seek(0, os.SEEK_END)
            tam = f.tell()
            f.seek(max(0, tam - maximo))
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def ejecutar(
    codigo: str,
    modo: str = "generar",
    opciones: dict[str, Any] | None = None,
    limites: Limites | None = None,
) -> Resultado:
    """Ejecuta el código en un hijo aislado. Nunca lanza por culpa del código del usuario."""
    rechazo = revisar(codigo)
    if rechazo is not None:
        return Resultado(False, {"ok": False, "error": rechazo.como_dict()})

    limites = limites or Limites()
    dir_trabajo = tempfile.mkdtemp(prefix="cad-libre-")
    try:
        with open(os.path.join(dir_trabajo, "entrada.json"), "w", encoding="utf-8") as f:
            json.dump({"codigo": codigo, "modo": modo, "opciones": opciones or {}}, f)
        ruta_salida = os.path.join(dir_trabajo, "consola.txt")
        with open(ruta_salida, "wb") as consola:
            # En Linux (Lambda/Docker) el hijo lleva límites de CPU/memoria/archivo (rlimit).
            # Windows no tiene rlimit: solo se aplica el tiempo de reloj. Es para desarrollo local.
            opciones_so: dict[str, Any] = (
                {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                if ES_WINDOWS
                else {"start_new_session": True, "preexec_fn": _preparar_hijo(limites)}
            )
            proceso = subprocess.Popen(
                [sys.executable, "-I", "-B", TRABAJADOR],
                cwd=dir_trabajo,
                env=_entorno_hijo(),  # sin credenciales ni rutas heredadas
                stdin=subprocess.DEVNULL,
                stdout=consola,
                stderr=subprocess.STDOUT,
                close_fds=True,
                **opciones_so,
            )
            try:
                codigo_salida = proceso.wait(timeout=limites.tiempo_s)
            except subprocess.TimeoutExpired:
                _matar_grupo(proceso)
                proceso.wait()
                return Resultado(
                    False,
                    {
                        "ok": False,
                        "error": {
                            "tipo": "tiempo",
                            "mensaje": f"El diseño tardó más de {limites.tiempo_s} s y se detuvo. "
                            "Revise bucles infinitos o geometría demasiado detallada.",
                        },
                    },
                )
            finally:
                _matar_grupo(proceso)  # por si dejó nietos vivos

        ruta_resultado = os.path.join(dir_trabajo, "resultado.json")
        if not os.path.exists(ruta_resultado):
            return Resultado(False, {"ok": False, "error": _error_sin_resultado(codigo_salida, ruta_salida)})
        if os.path.getsize(ruta_resultado) > MAX_RESULTADO:
            return Resultado(False, {"ok": False, "error": {"tipo": "salida", "mensaje": "El resultado es demasiado grande."}})
        with open(ruta_resultado, encoding="utf-8") as f:
            try:
                datos = json.load(f)
            except ValueError:
                return Resultado(False, {"ok": False, "error": {"tipo": "salida", "mensaje": "Resultado ilegible."}})
        if not isinstance(datos, dict):
            return Resultado(False, {"ok": False, "error": {"tipo": "salida", "mensaje": "Resultado ilegible."}})
        binario = None
        ruta_bin = os.path.join(dir_trabajo, "salida.bin")
        if datos.get("ok") and modo in ("dxf", "step"):
            if not os.path.exists(ruta_bin) or os.path.getsize(ruta_bin) > MAX_SALIDA_BIN:
                return Resultado(False, {"ok": False, "error": {"tipo": "salida", "mensaje": "Falta el archivo exportado."}})
            with open(ruta_bin, "rb") as f:
                binario = f.read()
        return Resultado(bool(datos.get("ok")), datos, binario)
    finally:
        shutil.rmtree(dir_trabajo, ignore_errors=True)


def _error_sin_resultado(codigo_salida: int, ruta_consola: str) -> dict[str, Any]:
    cola = _leer_cola(ruta_consola)
    sigxcpu = getattr(signal, "SIGXCPU", None)
    sigxfsz = getattr(signal, "SIGXFSZ", None)
    if codigo_salida in tuple(x for x in (-sigxcpu if sigxcpu else None, -signal.SIGKILL) if x):
        return {"tipo": "tiempo", "mensaje": "El diseño agotó el tiempo de CPU y se detuvo."}
    if "MemoryError" in cola or codigo_salida in (-signal.SIGSEGV, -signal.SIGABRT) or "bad_alloc" in cola:
        return {"tipo": "memoria", "mensaje": "El diseño superó el límite de memoria."}
    if sigxfsz and codigo_salida == -sigxfsz:
        return {"tipo": "salida", "mensaje": "El diseño intentó escribir demasiados datos."}
    return {
        "tipo": "ejecucion",
        "mensaje": f"El proceso del diseño terminó sin resultado (código {codigo_salida}).",
        "traza": cola[-1500:],
    }
