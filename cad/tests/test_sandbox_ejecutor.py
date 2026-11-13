"""
El sandbox ejecuta diseños válidos y contiene los que no lo son.

Cada prueba lanza un proceso hijo real (unos segundos por la importación de
build123d), así que las pruebas comparten resultados cuando pueden.
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
import textwrap
from functools import lru_cache

import pytest

from motor.exportar import leer_json_glb
from sandbox.ejecutor import Limites, ejecutar

from conftest import leer_dxf

#: Soporte de teléfono en L: base con ranura y respaldo con pestaña que encaja.
SOPORTE = textwrap.dedent(
    """
    from diseno import pieza, rectangulo, poligono, con_agujeros, ranura, ubicar, linea

    e = 3
    ancho = 80
    fondo = 100
    alto = 110
    pestana = 50
    y_ranura = 30

    x_pestana = (ancho - pestana) / 2
    base = con_agujeros(rectangulo(ancho, fondo), [ranura(x_pestana, y_ranura, pestana, e)])
    respaldo = poligono([
        (0, e), (x_pestana, e), (x_pestana, 0), (x_pestana + pestana, 0),
        (x_pestana + pestana, e), (ancho, e), (ancho, alto), (0, alto),
    ])

    piezas = [
        pieza("base", "Base", base, e, [ubicar((0, 0, 0), (1, 0, 0), (0, 0, 1))],
              grabado=[linea(10, 80, 70, 80)]),
        pieza("respaldo", "Respaldo", respaldo, e,
              [ubicar((0, y_ranura + e, 0), (1, 0, 0), (0, -1, 0))]),
    ]
    nombre = "Soporte de teléfono"
    print("listo")
    """
)

RAPIDO = Limites(tiempo_s=20, cpu_s=15, memoria_mb=3072, archivo_mb=64)


@lru_cache(maxsize=None)
def _ejecutar(codigo: str, modo: str = "generar"):
    return ejecutar(codigo, modo, limites=RAPIDO)


def test_diseno_valido_ida_y_vuelta():
    r = _ejecutar(SOPORTE)
    assert r.ok, r.datos
    d = r.datos
    assert d["nombre"] == "Soporte de teléfono"
    assert d["dimensiones"] == {"x": 80.0, "y": 100.0, "z": 110.0}
    ids = [p["id"] for p in d["piezas"]]
    assert ids == ["base", "respaldo"]
    assert all(p["espesor_mm"] == 3.0 for p in d["piezas"])
    # La pestaña encaja en la ranura: no hay interferencias.
    assert not [v for v in d["validaciones"] if v["nivel"] == "error"], d["validaciones"]
    gltf = leer_json_glb(base64.b64decode(d["glb_base64"]))
    assert sorted(n["name"] for n in gltf["nodes"]) == ["base", "respaldo"]
    assert d["salida"] == "listo\n"


def test_dxf_y_step():
    r = _ejecutar(SOPORTE, "dxf")
    assert r.ok and r.binario
    doc = leer_dxf(r.binario)
    capas = {e.dxf.layer for e in doc.modelspace()}
    assert capas == {"CORTE", "GRABADO"}
    r = _ejecutar(SOPORTE, "step")
    assert r.ok and r.binario.startswith(b"ISO-10303-21")


def test_error_de_ejecucion_con_linea_y_traza():
    r = _ejecutar("from diseno import rectangulo\nx = 1\ny = rectangulo(10, 10) / 0\n")
    assert not r.ok
    assert r.error["tipo"] == "ejecucion"
    assert r.error["linea"] == 3
    assert "diseno_libre.py" in r.error["traza"]


def test_contrato_sin_piezas():
    r = _ejecutar("x = 1\n")
    assert not r.ok and r.error["tipo"] == "contrato"
    r = _ejecutar("from build123d import Box\npiezas = [Box(1, 1, 1)]\n")
    assert not r.ok and r.error["tipo"] == "contrato"


def test_prohibido_no_llega_a_ejecutarse():
    r = ejecutar("import os\nos.system('touch /tmp/pwned')\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "prohibido" and r.error["linea"] == 1


def test_bucle_infinito_se_mata_por_tiempo():
    r = ejecutar("while True:\n    pass\n", limites=Limites(tiempo_s=6, cpu_s=60, memoria_mb=3072, archivo_mb=8))
    assert not r.ok and r.error["tipo"] == "tiempo"


def test_bucle_infinito_se_corta_por_cpu():
    r = ejecutar("x = 0\nwhile True:\n    x += 1\n", limites=Limites(tiempo_s=60, cpu_s=6, memoria_mb=3072, archivo_mb=8))
    assert not r.ok and r.error["tipo"] == "tiempo"


def test_bomba_de_memoria_contenida():
    r = ejecutar("x = [0] * (10 ** 10)\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "memoria", r.datos
    r = ejecutar("x = 'a' * (8 * 10 ** 9)\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "memoria", r.datos


def test_build123d_filtrado_sin_es_de_archivos():
    # Aunque se esquive el nombre, el módulo expuesto no tiene E/S de archivos ni módulos.
    codigo = textwrap.dedent(
        """
        import build123d
        nombres = [n for n in list(build123d.__all__)]
        """
    )
    r = ejecutar(codigo, limites=RAPIDO)  # `__all__` tiene guion bajo: lo frena el AST
    assert not r.ok and r.error["tipo"] == "prohibido"
    r = ejecutar("from build123d import *\nx = Mesher\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "prohibido"
    r = ejecutar("from build123d import *\nx = BRepTools\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "ejecucion" and "BRepTools" in r.error["mensaje"]
    r = ejecutar("from build123d import *\nx = ezdxf\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "ejecucion"


def test_leer_archivos_fuera_del_sandbox_falla():
    # `Text` con una ruta de fuente arbitraria la frena el AST; un intento sin AST lo frena el gancho.
    r = ejecutar("from build123d import Text\nx = Text('a', 5, font_path='/etc/passwd')\n", limites=RAPIDO)
    assert not r.ok and r.error["tipo"] == "prohibido"


def test_directorio_temporal_borrado():
    import tempfile

    raiz = tempfile.gettempdir()
    antes = {n for n in os.listdir(raiz) if n.startswith("cad-libre-")}
    r = ejecutar(SOPORTE.replace('print("listo")', "print(len(piezas))"), limites=RAPIDO)
    assert r.ok
    despues = {n for n in os.listdir(raiz) if n.startswith("cad-libre-")}
    assert despues <= antes


def _con_gancho(cuerpo: str) -> subprocess.CompletedProcess:
    """Ejecuta `cuerpo` en un Python aparte con el gancho de auditoría del trabajador instalado."""
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    programa = textwrap.dedent(
        f"""
        import os, sys, tempfile
        sys.path.insert(0, {raiz!r})
        sys.path.insert(0, {os.path.join(raiz, "sandbox")!r})
        from trabajador import _instalar_gancho
        d = tempfile.mkdtemp()
        os.chdir(d)
        _instalar_gancho(os.path.realpath(d))
        """
    ) + textwrap.dedent(cuerpo)
    return subprocess.run([sys.executable, "-I", "-c", programa], capture_output=True, text=True, timeout=60)


@pytest.mark.parametrize(
    "cuerpo",
    [
        "import socket\ns = socket.socket()\ns.connect(('1.1.1.1', 80))\n",
        "import subprocess\nsubprocess.run(['true'])\n",
        "os.system('true')\n",
        "os.fork()\n",
        "open('/etc/passwd').read()\n",
        "open('/tmp/fuera-del-sandbox.txt', 'w')\n",
        "import ctypes\nctypes.CDLL(None)\n",
    ],
    ids=["red", "subproceso", "system", "fork", "leer", "escribir", "ctypes"],
)
def test_gancho_de_auditoria_bloquea(cuerpo):
    r = _con_gancho(cuerpo)
    assert r.returncode != 0
    assert "PermissionError" in r.stderr, r.stderr


def test_gancho_permite_escribir_en_el_temporal():
    r = _con_gancho("open('x.txt', 'w').write('ok')\nprint(open('x.txt').read())\n")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "ok"
