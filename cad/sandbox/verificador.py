"""
Revisión estática (AST) del código del diseño libre, antes de ejecutarlo.

Es **defensa en profundidad**: rechaza pronto y con un mensaje útil lo que no
debe aparecer en un diseño (imports fuera de la lista, nombres y atributos
peligrosos, acceso a atributos con guion bajo). No es una frontera de
seguridad por sí sola: Python tiene demasiados caminos indirectos. La
frontera real es el despliegue (ver README).
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

#: Módulos que el código puede importar (solo el módulo raíz, sin submódulos).
MODULOS_PERMITIDOS = frozenset({"build123d", "math", "diseno"})

#: Nombres que no pueden aparecer nunca (ni leerse ni asignarse).
NOMBRES_PROHIBIDOS = frozenset(
    {
        "open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars",
        "getattr", "setattr", "delattr", "hasattr", "breakpoint", "input", "help", "memoryview",
        "dir", "type", "super", "object", "classmethod", "staticmethod", "property",
        "os", "sys", "subprocess", "socket", "shutil", "pathlib", "io", "ctypes", "importlib",
        "builtins", "pickle", "marshal", "threading", "multiprocessing", "signal", "inspect",
        "gc", "resource", "tempfile", "urllib", "http", "requests", "exit", "quit", "license",
        "copyright", "credits", "bytearray",
    }
)

#: Atributos que no se pueden usar aunque no empiecen por guion bajo
#: (módulos alcanzables a través de otros módulos, marcos, cadenas de formato...).
ATRIBUTOS_PROHIBIDOS = frozenset(
    {
        "os", "sys", "subprocess", "socket", "shutil", "pathlib", "io", "ctypes", "importlib",
        "builtins", "pickle", "marshal", "threading", "multiprocessing", "signal", "inspect",
        "gc", "tempfile", "urllib", "http", "logging", "warnings", "codecs", "zipfile", "tarfile",
        "system", "popen", "spawn", "spawnl", "spawnv", "execv", "execve", "execl", "fork",
        "kill", "remove", "unlink", "rmdir", "rmtree", "environ", "getenv", "putenv",
        "chdir", "mkdir", "makedirs", "rename", "replace_file", "walk", "listdir", "scandir",
        "format", "format_map", "mro", "gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame",
        "f_globals", "f_locals", "f_back", "f_builtins", "f_code", "tb_frame", "tb_next",
        "co_code", "func_globals", "load", "loads", "dump", "dumps", "read_text", "write_text",
        "read_bytes", "write_bytes", "open", "connect", "urlopen", "exec_module", "load_module",
        "import_module", "find_spec", "modules", "loader", "spec",
    }
)

#: Prefijos/fragmentos de nombres de E/S de archivos de build123d/OCP. OCC lee y
#: escribe archivos desde C++, fuera del gancho de auditoría de Python, así que
#: se cortan aquí y además no se exponen en el módulo `build123d` filtrado.
PATRON_ES = re.compile(r"^(import|export)|mesher|font_path|^write|^read|wrapped|topods", re.IGNORECASE)

#: Nodos que no tienen sentido en un diseño y abren caminos raros.
NODOS_PROHIBIDOS: dict[type, str] = {
    ast.ClassDef: "definir clases",
    ast.AsyncFunctionDef: "funciones asíncronas",
    ast.Await: "await",
    ast.AsyncFor: "async for",
    ast.AsyncWith: "async with",
    ast.Global: "global",
    ast.Nonlocal: "nonlocal",
    ast.With: "with",
    ast.Try: "try/except",
}
if hasattr(ast, "TryStar"):
    NODOS_PROHIBIDOS[ast.TryStar] = "try/except*"

#: Largo máximo del código fuente.
MAX_CARACTERES = 60_000


@dataclass
class Rechazo:
    tipo: str  # "sintaxis" | "prohibido"
    mensaje: str
    linea: int | None = None
    columna: int | None = None

    def como_dict(self) -> dict:
        return {"tipo": self.tipo, "mensaje": self.mensaje, "linea": self.linea, "columna": self.columna}


def _con_guion(nombre: str) -> bool:
    return nombre.startswith("_")


def revisar(codigo: str) -> Rechazo | None:
    """Devuelve el primer motivo de rechazo, o `None` si el código pasa el filtro."""
    if not isinstance(codigo, str) or not codigo.strip():
        return Rechazo("prohibido", "El código está vacío.")
    if len(codigo) > MAX_CARACTERES:
        return Rechazo("prohibido", f"El código supera los {MAX_CARACTERES} caracteres.")
    if "\x00" in codigo:
        return Rechazo("prohibido", "El código contiene caracteres nulos.")
    try:
        arbol = ast.parse(codigo, filename="diseno_libre.py", mode="exec")
    except SyntaxError as e:
        return Rechazo("sintaxis", f"Error de sintaxis: {e.msg}", e.lineno, e.offset)

    for nodo in ast.walk(arbol):
        linea = getattr(nodo, "lineno", None)
        col = getattr(nodo, "col_offset", None)

        def no(mensaje: str) -> Rechazo:
            return Rechazo("prohibido", mensaje, linea, col)

        for tipo, que in NODOS_PROHIBIDOS.items():
            if isinstance(nodo, tipo):
                return no(f"No se permite {que} en un diseño.")

        if isinstance(nodo, ast.Import):
            for alias in nodo.names:
                if alias.name not in MODULOS_PERMITIDOS:
                    return no(f"No se puede importar «{alias.name}». Solo: {', '.join(sorted(MODULOS_PERMITIDOS))}.")
                if alias.asname and _con_guion(alias.asname):
                    return no("Los nombres no pueden empezar por guion bajo.")
        elif isinstance(nodo, ast.ImportFrom):
            if nodo.level or nodo.module not in MODULOS_PERMITIDOS:
                return no(
                    f"No se puede importar desde «{nodo.module or '.'}». Solo: {', '.join(sorted(MODULOS_PERMITIDOS))}."
                )
            for alias in nodo.names:
                if alias.name != "*" and (
                    _con_guion(alias.name) or alias.name in NOMBRES_PROHIBIDOS or PATRON_ES.search(alias.name)
                ):
                    return no(f"No se puede importar «{alias.name}».")
                if alias.asname and (_con_guion(alias.asname) or alias.asname in NOMBRES_PROHIBIDOS):
                    return no(f"No se puede usar el nombre «{alias.asname}».")
        elif isinstance(nodo, ast.Name):
            if _con_guion(nodo.id) and nodo.id != "_":
                return no(f"Los nombres no pueden empezar por guion bajo («{nodo.id}»).")
            if nodo.id in NOMBRES_PROHIBIDOS or PATRON_ES.search(nodo.id):
                return no(f"No se permite usar «{nodo.id}».")
        elif isinstance(nodo, ast.Attribute):
            if _con_guion(nodo.attr):
                return no(f"No se permite acceder a atributos con guion bajo («.{nodo.attr}»).")
            if nodo.attr in ATRIBUTOS_PROHIBIDOS or PATRON_ES.search(nodo.attr):
                return no(f"No se permite el atributo «.{nodo.attr}».")
        elif isinstance(nodo, (ast.FunctionDef, ast.Lambda)):
            nombre = getattr(nodo, "name", "")
            if nombre and (_con_guion(nombre) or nombre in NOMBRES_PROHIBIDOS):
                return no(f"No se puede definir la función «{nombre}».")
            args = nodo.args
            for a in [*args.posonlyargs, *args.args, *args.kwonlyargs, args.vararg, args.kwarg]:
                if a is not None and (_con_guion(a.arg) or a.arg in NOMBRES_PROHIBIDOS):
                    return no(f"No se puede usar el parámetro «{a.arg}».")
        elif isinstance(nodo, ast.keyword):
            if nodo.arg and _con_guion(nodo.arg):
                return no("Los argumentos con nombre no pueden empezar por guion bajo.")
            if nodo.arg and PATRON_ES.search(nodo.arg):
                return no(f"No se permite el argumento «{nodo.arg}».")
        elif isinstance(nodo, ast.Constant) and isinstance(nodo.value, str):
            # Cadenas con dunders: típicas de getattr indirecto o de formato.
            if "__" in nodo.value:
                return no("Las cadenas no pueden contener «__».")
        elif isinstance(nodo, ast.Constant) and isinstance(nodo.value, bytes):
            return no("No se permiten literales bytes.")
        elif isinstance(nodo, ast.alias):
            pass
    return None
