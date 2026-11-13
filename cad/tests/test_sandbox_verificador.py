"""El filtro AST del sandbox rechaza cada clase de construcción prohibida."""

from __future__ import annotations

import pytest

from sandbox.verificador import revisar

VALIDO = """
import math
from build123d import Vector
from diseno import pieza, rectangulo, ubicar

def lado(n):
    return rectangulo(10 * n, 20)

piezas = [pieza("a", "A", lado(2), 3, [ubicar((0, 0, 0), (1, 0, 0), (0, 0, 1))])]
"""


def test_codigo_valido_pasa():
    assert revisar(VALIDO) is None


@pytest.mark.parametrize(
    ("codigo", "fragmento"),
    [
        ("import os", "importar «os»"),
        ("import subprocess", "importar «subprocess»"),
        ("import socket", "importar «socket»"),
        ("from os import system", "importar desde «os»"),
        ("import build123d.exporters", "importar «build123d.exporters»"),
        ("from . import x", "importar desde"),
        ("x = open('/etc/passwd')", "«open»"),
        ("eval('1')", "«eval»"),
        ("exec('1')", "«exec»"),
        ("__import__('os')", "guion bajo"),
        ("compile('1', 'a', 'exec')", "«compile»"),
        ("getattr(1, 'real')", "«getattr»"),
        ("x = ().__class__", "atributos con guion bajo"),
        ("x = (1).__class__.__mro__", "atributos con guion bajo"),
        ("import math\nmath._x", "atributos con guion bajo"),
        ("import build123d\nx = build123d.os.name", "«.os»"),
        ("x = '{0.__class__}'", "«__»"),
        ("from build123d import export_stl", "«export_stl»"),
        ("from build123d import import_step", "«import_step»"),
        ("import build123d\nbuild123d.export_step(1, 'x')", "«.export_step»"),
        ("from build123d import Text\nText('a', 5, font_path='/etc/passwd')", "«font_path»"),
        ("from build123d import Box\nx = Box(1, 1, 1).wrapped", "«.wrapped»"),
        ("x = '{}'.format", "«.format»"),
        ("def f():\n    yield 1\ng = f().gi_frame", "«.gi_frame»"),
        ("class A:\n    pass", "clases"),
        ("try:\n    x = 1\nexcept Exception:\n    pass", "try/except"),
        ("with x:\n    pass", "with"),
        ("global x", "global"),
        ("_oculto = 1", "guion bajo"),
        ("type(1)", "«type»"),
        ("b = b'abc'", "bytes"),
        ("x = (", "sintaxis"),
        ("", "vacío"),
    ],
)
def test_construcciones_prohibidas(codigo, fragmento):
    rechazo = revisar(codigo)
    assert rechazo is not None, codigo
    assert fragmento in rechazo.mensaje, (codigo, rechazo.mensaje)
    assert rechazo.tipo in ("sintaxis", "prohibido")


def test_informa_linea():
    rechazo = revisar("x = 1\ny = 2\nimport os\n")
    assert rechazo is not None and rechazo.linea == 3


def test_error_de_sintaxis_con_linea():
    rechazo = revisar("x = 1\ndef f(:\n")
    assert rechazo is not None and rechazo.tipo == "sintaxis" and rechazo.linea == 2


def test_codigo_demasiado_largo():
    assert revisar("x = 1\n" * 20_000) is not None
