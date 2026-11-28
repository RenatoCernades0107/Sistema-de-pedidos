"""
Proceso hijo que ejecuta un diseño libre. Lo lanza `ejecutor.py`, nunca la API.

Entrada: `entrada.json` en el directorio actual (temporal) con
`{"codigo": str, "modo": "generar"|"dxf"|"dxf_planchas"|"step", "opciones": {...},
"contornos": {nombre: {ancho_mm, alto_mm, trazos}}}`.
Salida: `resultado.json` (y `salida.bin` para dxf/dxf_planchas/step) en el mismo
directorio. En `dxf_planchas`, `opciones` trae `kerf_mm` y `planchas` (el acomodo,
con la forma de `/dxf/planchas` del motor).

Capas, en este orden:
  1. Límites de recursos (los pone el padre antes de exec: CPU, memoria,
     tamaño de archivo, sin core dumps) y entorno vacío.
  2. Importa build123d y el motor (antes de cualquier restricción).
  3. Gancho de auditoría (`sys.addaudithook`): sin procesos, sin sockets,
     sin ctypes; `open` solo lectura dentro de la instalación de Python y del
     motor, y escritura solo dentro del directorio temporal.
  4. Revisión AST (`verificador.revisar`).
  5. `exec` con builtins reducidos y un `__import__` con lista blanca.
"""

from __future__ import annotations

import json
import os
import sys
import traceback

RAIZ_CAD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_SANDBOX = os.path.join(RAIZ_CAD, "sandbox")
for _ruta in (RAIZ_CAD, DIR_SANDBOX):
    if _ruta not in sys.path:
        sys.path.insert(0, _ruta)

ARCHIVO_CODIGO = "diseno_libre.py"
MAX_PIEZAS = 200
MAX_UBICACIONES = 500
MAX_SALIDA_IMPRESA = 8_000


def _escribir(resultado: dict) -> None:
    with open("resultado.json", "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False)


def _fallo(tipo: str, mensaje: str, **extra) -> None:
    _escribir({"ok": False, "error": {"tipo": tipo, "mensaje": mensaje, **extra}})


def main() -> int:
    with open("entrada.json", encoding="utf-8") as f:
        entrada = json.load(f)
    codigo: str = entrada.get("codigo") or ""
    modo: str = entrada.get("modo", "generar")
    opciones: dict = entrada.get("opciones") or {}
    contornos: dict = entrada.get("contornos") or {}

    # 2. Imports pesados, antes de restringir nada.
    import base64
    import builtins
    import math

    import build123d
    from motor.exportar import (
        ErrorAcomodo,
        PiezaEnPlancha,
        PlanchaAcomodada,
        exportar_dxf,
        exportar_dxf_planchas,
        exportar_glb,
        exportar_step,
        validar_planchas,
    )
    from motor.plantillas.base import Diseno, Parametros, Pieza, Plantilla
    from motor.proyecto import disenar_plantilla, seleccionar_copias, unir_disenos
    from motor.validacion import validar

    import diseno as modulo_diseno
    from verificador import revisar

    dir_trabajo = os.path.realpath(os.getcwd())
    _instalar_gancho(dir_trabajo)

    def construir_diseno(codigo: str, contornos: dict):
        """
        Ejecuta el código de un diseño libre y arma su `Diseno`. Si algo falla escribe
        el resultado de error y devuelve `None`; si no, `(diseno, nombre, salida impresa)`.
        """
        # Los logos del diseño: quedan en el módulo `diseno` (el código del usuario no
        # puede tocar nombres con guion bajo; solo los pide con `caras_de_contorno`).
        modulo_diseno._fijar_contornos(contornos)

        # 4. Revisión estática (el padre ya la hizo; se repite por si se llama directo).
        rechazo = revisar(codigo)
        if rechazo is not None:
            _escribir({"ok": False, "error": rechazo.como_dict()})
            return None

        # 5. Ejecución restringida.
        salida_impresa: list[str] = []
        largo_impreso = [0]

        def imprimir(*args, sep=" ", end="\n", **_):
            texto = sep.join(str(a) for a in args) + end
            if largo_impreso[0] < MAX_SALIDA_IMPRESA:
                salida_impresa.append(texto[: MAX_SALIDA_IMPRESA - largo_impreso[0]])
            largo_impreso[0] += len(texto)

        modulos = {
            "build123d": _modulo_filtrado("build123d", build123d, _publicos_build123d(build123d)),
            "math": math,
            "diseno": _modulo_filtrado("diseno", modulo_diseno, list(modulo_diseno.__all__) + ["pi"]),
        }

        def importar(nombre, globales=None, locales=None, desde=(), nivel=0):
            if nivel != 0 or nombre not in modulos:
                raise ImportError(f"No se puede importar «{nombre}» en un diseño.")
            return modulos[nombre]

        seguros = {
            n: getattr(builtins, n)
            for n in (
                "abs all any bool dict divmod enumerate filter float frozenset int isinstance issubclass "
                "iter len list map max min next pow range repr reversed round set slice sorted str sum "
                "tuple zip chr ord hash id callable True False None "
                "Exception ValueError TypeError ArithmeticError ZeroDivisionError IndexError KeyError "
                "RuntimeError AssertionError NotImplementedError StopIteration"
            ).split()
        }
        seguros["print"] = imprimir
        seguros["__import__"] = importar
        seguros["__build_class__"] = builtins.__build_class__
        globales = {"__builtins__": seguros, "__name__": "diseno_libre"}

        try:
            compilado = compile(codigo, ARCHIVO_CODIGO, "exec")
            exec(compilado, globales)  # noqa: S102 - es el propósito del sandbox
        except MemoryError:
            _fallo("memoria", "El diseño superó el límite de memoria.", salida="".join(salida_impresa))
            return None
        except RecursionError:
            _fallo("ejecucion", "Recursión demasiado profunda.", salida="".join(salida_impresa))
            return None
        except BaseException as e:  # noqa: BLE001
            _fallo(
                "ejecucion",
                f"{type(e).__name__}: {e}"[:2000],
                linea=_linea_de(e),
                traza=_traza_recortada(e),
                salida="".join(salida_impresa),
            )
            return None

        # Contrato: una lista `piezas` de `Pieza`.
        piezas = globales.get("piezas")
        if piezas is None:
            _fallo("contrato", "El código debe asignar `piezas = [pieza(...), ...]` (lista de piezas de `diseno`).")
            return None
        if isinstance(piezas, Pieza):
            piezas = [piezas]
        if not isinstance(piezas, (list, tuple)) or not piezas:
            _fallo("contrato", "`piezas` debe ser una lista no vacía de piezas creadas con `diseno.pieza(...)`.")
            return None
        if len(piezas) > MAX_PIEZAS:
            _fallo("contrato", f"Demasiadas piezas distintas ({len(piezas)}; máximo {MAX_PIEZAS}).")
            return None
        for i, p in enumerate(piezas):
            if not isinstance(p, Pieza):
                _fallo("contrato", f"`piezas[{i}]` no es una pieza: use `diseno.pieza(...)`.")
                return None
        if sum(p.cantidad for p in piezas) > MAX_UBICACIONES:
            _fallo("contrato", f"Demasiadas ubicaciones en total (máximo {MAX_UBICACIONES}).")
            return None
        ids = [p.id for p in piezas]
        repetidos = sorted({i for i in ids if ids.count(i) > 1})
        if repetidos:
            _fallo("contrato", f"Hay ids de pieza repetidos: {', '.join(repetidos)}.")
            return None

        nombre = globales.get("nombre")
        nombre = str(nombre)[:120] if isinstance(nombre, str) else "Diseño libre"

        class ParametrosLibre(Parametros):
            pass

        plantilla = Plantilla(
            codigo="libre",
            nombre=nombre,
            familia="displays",
            version=1,
            descripcion="Diseño libre generado con código build123d.",
            modelo=ParametrosLibre,
            construir=lambda _p: list(piezas),
        )
        diseno = Diseno(plantilla=plantilla, parametros=ParametrosLibre(), piezas=list(piezas))
        return diseno, nombre, "".join(salida_impresa)

    if modo == "dxf_proyecto":
        return _dxf_proyecto(
            entrada,
            opciones,
            construir_diseno,
            disenar_plantilla=disenar_plantilla,
            unir_disenos=unir_disenos,
            validar_planchas=validar_planchas,
            exportar_dxf_planchas=exportar_dxf_planchas,
            ErrorAcomodo=ErrorAcomodo,
            PlanchaAcomodada=PlanchaAcomodada,
            PiezaEnPlancha=PiezaEnPlancha,
        )

    construido = construir_diseno(codigo, contornos)
    if construido is None:
        return 0
    diseno, nombre, salida_impresa_texto = construido

    try:
        if modo == "dxf":
            solo = opciones.get("solo")
            if solo:
                # Solo algunas copias (lo que se corta aparte, el MDF): el resto no se dibuja.
                try:
                    diseno = seleccionar_copias(diseno, {str(k): [int(i) for i in v] for k, v in solo.items()})
                except ValueError as e:
                    _fallo("contrato", str(e))
                    return 0
            contenido = exportar_dxf(
                diseno,
                kerf_mm=float(opciones.get("kerf_mm", 0)),
                separacion_mm=float(opciones.get("separacion_mm", 5)),
            )
            with open("salida.bin", "wb") as f:
                f.write(contenido)
            _escribir({"ok": True, "nombre": nombre})
        elif modo == "dxf_planchas":
            planchas = _planchas_de(opciones, PlanchaAcomodada, PiezaEnPlancha)
            parcial = bool(opciones.get("parcial", False))
            unidades = max(1, int(opciones.get("unidades", 1) or 1))
            try:
                validar_planchas(diseno, planchas, parcial=parcial, unidades=unidades)
            except ErrorAcomodo as e:
                # No es culpa del código: el acomodo no corresponde a estas piezas.
                _escribir(
                    {
                        "ok": False,
                        "error": {"tipo": "acomodo", "mensaje": e.mensaje},
                        "acomodo": {"mensaje": e.mensaje, "errores": e.errores},
                    }
                )
                return 0
            contenido = exportar_dxf_planchas(
                diseno,
                planchas,
                kerf_mm=float(opciones.get("kerf_mm", 0)),
                parcial=parcial,
                unidades=unidades,
            )
            with open("salida.bin", "wb") as f:
                f.write(contenido)
            _escribir({"ok": True, "nombre": nombre})
        elif modo == "step":
            contenido = exportar_step(diseno)
            with open("salida.bin", "wb") as f:
                f.write(contenido)
            _escribir({"ok": True, "nombre": nombre})
        else:
            glb = exportar_glb(diseno)
            _escribir(
                {
                    "ok": True,
                    "nombre": nombre,
                    "dimensiones": diseno.dimensiones(),
                    "glb_base64": base64.b64encode(glb).decode("ascii"),
                    "piezas": diseno.despiece(),
                    "validaciones": validar(diseno),
                    "salida": salida_impresa_texto,
                }
            )
    except MemoryError:
        _fallo("memoria", "El diseño superó el límite de memoria al exportar.")
    except BaseException as e:  # noqa: BLE001
        _fallo(
            "geometria",
            f"Las piezas no forman geometría válida: {type(e).__name__}: {e}"[:2000],
            traza=_traza_recortada(e),
        )
    return 0


def _planchas_de(opciones: dict, PlanchaAcomodada, PiezaEnPlancha) -> list:
    """Las planchas del acomodo tal como llegan en `opciones["planchas"]` (la forma de `/dxf/planchas`)."""
    return [
        PlanchaAcomodada(
            ancho_mm=float(p["ancho_mm"]),
            alto_mm=float(p["alto_mm"]),
            piezas=[
                PiezaEnPlancha(
                    str(pp["id"]),
                    int(pp["indice"]),
                    float(pp["x_mm"]),
                    float(pp["y_mm"]),
                    bool(pp.get("rotada", False)),
                )
                for pp in p.get("piezas") or []
            ],
            etiqueta=str(p["etiqueta"])[:120] if p.get("etiqueta") else None,
        )
        for p in opciones.get("planchas") or []
    ]


def _dxf_proyecto(
    entrada: dict,
    opciones: dict,
    construir_diseno,
    *,
    disenar_plantilla,
    unir_disenos,
    validar_planchas,
    exportar_dxf_planchas,
    ErrorAcomodo,
    PlanchaAcomodada,
    PiezaEnPlancha,
) -> int:
    """
    El DXF por planchas de un proyecto: cada diseño (código libre o plantilla) se
    construye, se unen con el id de pieza prefijado por su referencia y se dibujan
    las planchas del acomodo. Como las copias que se cortan aparte (MDF) no van en
    ninguna plancha, la validación es `parcial`: sigue comprobando que ninguna copia
    esté repetida, que todas caigan dentro de su plancha y que no mezclen espesores.
    """
    disenos = []
    for d in entrada.get("disenos") or []:
        ref = str(d["ref"])
        try:
            if d.get("codigo"):
                construido = construir_diseno(str(d["codigo"]), d.get("contornos") or {})
                if construido is None:
                    _marcar_diseno_en_error(ref, str(d.get("nombre") or ref))
                    return 0
                disenos.append((ref, construido[0]))
            else:
                disenos.append((ref, disenar_plantilla(str(d.get("plantilla") or ""), d.get("parametros"))))
        except ValueError as e:
            _fallo("contrato", f"«{d.get('nombre') or ref}»: {e}"[:2000])
            return 0
    if not disenos:
        _fallo("contrato", "El proyecto no trae ningún diseño.")
        return 0
    try:
        unido = unir_disenos(disenos)
        planchas = _planchas_de(opciones, PlanchaAcomodada, PiezaEnPlancha)
        try:
            validar_planchas(unido, planchas, parcial=True)
        except ErrorAcomodo as e:
            _escribir(
                {
                    "ok": False,
                    "error": {"tipo": "acomodo", "mensaje": e.mensaje},
                    "acomodo": {"mensaje": e.mensaje, "errores": e.errores},
                }
            )
            return 0
        contenido = exportar_dxf_planchas(unido, planchas, kerf_mm=float(opciones.get("kerf_mm", 0)), parcial=True)
        with open("salida.bin", "wb") as f:
            f.write(contenido)
        _escribir({"ok": True, "nombre": "Proyecto"})
    except MemoryError:
        _fallo("memoria", "El proyecto superó el límite de memoria al exportar.")
    except BaseException as e:  # noqa: BLE001
        _fallo(
            "geometria",
            f"Las piezas no forman geometría válida: {type(e).__name__}: {e}"[:2000],
            traza=_traza_recortada(e),
        )
    return 0


def _marcar_diseno_en_error(ref: str, nombre: str) -> None:
    """Un diseño del proyecto falló y ya escribió su error: le añade de qué diseño era."""
    try:
        with open("resultado.json", encoding="utf-8") as f:
            datos = json.load(f)
        if isinstance(datos.get("error"), dict):
            datos["error"]["diseno"] = ref
            datos["error"]["mensaje"] = f"En «{nombre}»: {datos['error'].get('mensaje', '')}"[:2000]
        _escribir(datos)
    except (OSError, ValueError):
        pass


#: Nombres de build123d que no se exponen aunque sean de build123d.
_OCULTOS_BUILD123D = {
    "logger", "modify_copyreg", "CLASS_REGISTRY", "GeomEncoder", "TYPE_CHECKING", "annotations",
    "offset_topods_face", "unwrap_topods_compound", "topods_lut", "downcast", "Drawing", "TechnicalDrawing",
}


def _publicos_build123d(modulo) -> list[str]:
    """Lista blanca derivada: solo objetos definidos en build123d, sin E/S de archivos ni OCP crudo."""
    import types

    from verificador import PATRON_ES

    nombres = []
    for nombre in dir(modulo):
        if nombre.startswith("_") or nombre in _OCULTOS_BUILD123D or PATRON_ES.search(nombre):
            continue
        objeto = getattr(modulo, nombre)
        if isinstance(objeto, types.ModuleType):
            continue
        if callable(objeto) or isinstance(objeto, type):
            if not str(getattr(objeto, "__module__", "")).startswith("build123d"):
                continue
        nombres.append(nombre)
    return nombres


def _modulo_filtrado(nombre: str, original, nombres: list[str]):
    import types

    nuevo = types.ModuleType(nombre)
    for n in nombres:
        setattr(nuevo, n, getattr(original, n))
    nuevo.__all__ = list(nombres)
    return nuevo


def _linea_de(e: BaseException) -> int | None:
    if isinstance(e, SyntaxError):
        return e.lineno
    linea = None
    for marco in traceback.extract_tb(e.__traceback__):
        if marco.filename == ARCHIVO_CODIGO:
            linea = marco.lineno
    return linea


def _traza_recortada(e: BaseException, max_lineas: int = 12) -> str:
    """Traza con los marcos del código del diseño y como mucho el último de la biblioteca."""
    marcos = traceback.extract_tb(e.__traceback__)
    propios = [i for i, m in enumerate(marcos) if m.filename == ARCHIVO_CODIGO]
    if propios:
        marcos = marcos[propios[0] : propios[-1] + 2]
    lineas = []
    for m in marcos[-max_lineas:]:
        archivo = m.filename if m.filename == ARCHIVO_CODIGO else os.path.basename(m.filename)
        lineas.append(f'  {archivo}, línea {m.lineno}, en {m.name}: {(m.line or "").strip()}')
    lineas.append(f"{type(e).__name__}: {e}"[:500])
    return "\n".join(lineas)[:3000]


def _instalar_gancho(dir_trabajo: str) -> None:
    """Gancho de auditoría permanente: una vez instalado no se puede quitar."""
    raices_lectura = tuple(
        os.path.realpath(r) + os.sep
        for r in {sys.prefix, sys.base_prefix, sys.exec_prefix, RAIZ_CAD, dir_trabajo, "/usr/share/fonts", "/etc/fonts"}
    )
    raiz_escritura = dir_trabajo + os.sep
    prohibidos = (
        "subprocess.", "os.system", "os.exec", "os.fork", "os.forkpty", "os.posix_spawn", "os.spawn",
        "os.kill", "os.killpg", "socket.", "ctypes.", "os.remove", "os.rmdir", "os.rename", "os.unlink",
        "shutil.", "os.chdir", "os.chmod", "os.chown", "os.putenv", "os.unsetenv", "os.symlink", "os.link",
        "os.truncate", "urllib.", "http.", "ftplib.", "smtplib.", "webbrowser.", "pty.", "resource.setrlimit",
        "sys.setrecursionlimit", "sys.settrace", "sys.setprofile", "sys.addaudithook", "mmap.",
    )

    def gancho(evento: str, args: tuple) -> None:
        if evento.startswith(prohibidos):
            raise PermissionError(f"Operación no permitida en el sandbox: {evento}")
        if evento == "open":
            ruta, modo = args[0], args[1]
            if isinstance(ruta, int):
                return
            try:
                real = os.path.realpath(os.fsdecode(ruta))
            except Exception:  # noqa: BLE001
                raise PermissionError("Ruta no válida.") from None
            escribe = isinstance(modo, str) and any(c in modo for c in "wax+")
            if isinstance(args[2], int) and args[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
                escribe = True
            if escribe:
                if not (real + os.sep).startswith(raiz_escritura):
                    raise PermissionError(f"No se puede escribir en «{real}».")
            elif not (real + os.sep).startswith(raices_lectura):
                raise PermissionError(f"No se puede leer «{real}».")

    sys.addaudithook(gancho)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except MemoryError:
        try:
            _fallo("memoria", "El diseño superó el límite de memoria.")
        finally:
            sys.exit(0)
