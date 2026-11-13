"""Ayudas comunes de las pruebas."""

from __future__ import annotations

import io
import itertools
from functools import lru_cache

import ezdxf
import pytest
from ezdxf import bbox

from motor.plantillas import obtener

UNIONES = ("a_tope", "encastre")
TAPAS = ((False, "simple"), (True, "simple"), (True, "con_pestana"))
ESPESORES = (2, 3, 5, 8)
TAMANOS = ((200, 150, 100), (120, 310, 64.5))

REJILLA = [
    {
        "largo": largo,
        "ancho": ancho,
        "alto": alto,
        "espesor": espesor,
        "tipo_union": union,
        "con_tapa": con_tapa,
        "tipo_tapa": tipo_tapa,
    }
    for union, (con_tapa, tipo_tapa), espesor, (largo, ancho, alto) in itertools.product(
        UNIONES, TAPAS, ESPESORES, TAMANOS
    )
]


def nombre_caso(p: dict) -> str:
    tapa = p["tipo_tapa"] if p["con_tapa"] else "sin_tapa"
    return f"{p['tipo_union']}-{tapa}-e{p['espesor']}-{p['largo']}x{p['ancho']}x{p['alto']}"


@lru_cache(maxsize=None)
def _caja(clave: tuple):
    return obtener("caja").disenar(dict(clave))


def disenar_caja(parametros: dict):
    """Diseño de caja, compartido entre pruebas (construirlo cuesta)."""
    return _caja(tuple(sorted(parametros.items())))


@pytest.fixture(params=REJILLA, ids=nombre_caso)
def caso(request):
    return request.param, disenar_caja(request.param)


def leer_dxf(contenido: bytes):
    return ezdxf.read(io.StringIO(contenido.decode("ascii")))


def caja_entidad(entidad) -> tuple[float, float, float, float]:
    e = bbox.extents([entidad], fast=False)
    return (e.extmin.x, e.extmin.y, e.extmax.x, e.extmax.y)


def entidades_en(doc, rect, tol=1e-4):
    """Entidades del modelo cuya caja cae dentro de un rectángulo."""
    x0, y0, x1, y1 = rect
    dentro = []
    for entidad in doc.modelspace():
        a0, b0, a1, b1 = caja_entidad(entidad)
        if a0 >= x0 - tol and b0 >= y0 - tol and a1 <= x1 + tol and b1 <= y1 + tol:
            dentro.append(entidad)
    return dentro


def caja_de(entidades) -> tuple[float, float, float, float]:
    cajas = [caja_entidad(e) for e in entidades]
    return (
        min(c[0] for c in cajas),
        min(c[1] for c in cajas),
        max(c[2] for c in cajas),
        max(c[3] for c in cajas),
    )


@pytest.fixture
def sin_clave(monkeypatch):
    monkeypatch.delenv("CAD_API_KEY", raising=False)
