"""
Plantilla «tareco»: porta nombre de escritorio en V invertida (doble cara).

SUPUESTO: el catálogo (`supabase/migrations/20261113000200_terminados_datos.sql`)
describe el tareco como «porta nombre en V (doble cara)» para carga de papel o
impreso, de 21–30 cm de largo × 10 cm de alto en acrílico de 2 mm, y como
«tareco en V con base y frente» (geometría `lamina_plegada`). El producto real
es una lámina doblada en caliente en forma de tienda de campaña con un nombre a
cada lado. Aquí se arma el **equivalente de piezas planas pegadas**: dos
paneles inclinados (las dos caras) apoyados en dos laterales triangulares, con
base opcional. Se avisa con `sin_plegado`.

`largo` (X) y `alto` (Z) son exteriores; el fondo (Y) sale del ángulo y se
informa en `dimensiones_esperadas`.

Convención de armado, en el perfil (y, z) con el centro en y = 0 y θ = `angulo`
sobre la horizontal:
  - Laterales: triángulos isósceles de canto en x ∈ [0, e] y [largo − e, largo],
    con la base en zb (e si hay base, 0 si no), media base b = hs / tan θ y
    vértice en (0, zb + hs), donde hs = alto − e·cos θ − zb.
  - Cada panel (`largo × hs / sin θ`) apoya su cara interior en un canto
    inclinado de los laterales; las dos caras se tocan en la arista del vértice.
  - Base opcional: plancha `largo × fondo` bajo todo, con fondo = 2b + 2e·sin θ.
"""

from __future__ import annotations

import math

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_poligono, cara_rectangulo, ubicar
from .registro import registrar


class ParametrosTareco(Parametros):
    largo: float = Field(210, title="Largo", description="Medida exterior de frente, en mm (eje X).", ge=40, le=1200)
    alto: float = Field(100, title="Alto", description="Altura exterior total, en mm (eje Z).", ge=20, le=600)
    angulo: float = Field(
        65, title="Ángulo", description="Inclinación de cada cara sobre la horizontal, en grados.", ge=40, le=85
    )
    espesor: float = Field(2, title="Espesor", description="Grosor de la plancha, en mm.", ge=1, le=10)
    con_base: bool = Field(False, title="Con base", description="Plancha de apoyo bajo el tareco.")

    @property
    def seno(self) -> float:
        return math.sin(math.radians(self.angulo))

    @property
    def coseno(self) -> float:
        return math.cos(math.radians(self.angulo))

    @property
    def zb(self) -> float:
        return self.espesor if self.con_base else 0.0

    @property
    def alto_lateral(self) -> float:
        return self.alto - self.espesor * self.coseno - self.zb

    @property
    def media_base(self) -> float:
        return self.alto_lateral * self.coseno / self.seno

    @property
    def fondo(self) -> float:
        return 2 * self.media_base + 2 * self.espesor * self.seno

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        if self.alto_lateral < 5 * e:
            errores.append(("alto", f"Con este espesor el alto mínimo es de unos {6 * e + self.zb:g} mm."))
        if self.media_base < 2 * e:
            errores.append(("angulo", "Con este ángulo el tareco queda demasiado angosto: bájelo."))
        if self.largo < 5 * e:
            errores.append(("largo", f"Debe ser al menos 5 veces el espesor ({5 * e:g} mm)."))
        return errores


def construir(p: ParametrosTareco) -> list[Pieza]:
    L, e, s, c = p.largo, p.espesor, p.seno, p.coseno
    hs, b, zb, F = p.alto_lateral, p.media_base, p.zb, p.fondo
    x0 = -L / 2
    lp = hs / s
    piezas = [
        Pieza(
            "lateral",
            "Lateral triangular",
            cara_poligono([(0, 0), (2 * b, 0), (b, hs)]),
            e,
            [ubicar((x0, -b, zb), (0, 1, 0), (1, 0, 0)), ubicar((x0 + L - e, -b, zb), (0, 1, 0), (1, 0, 0))],
        ),
        Pieza(
            "cara",
            "Cara inclinada",
            cara_rectangulo(L, lp),
            e,
            [
                ubicar((x0, -b, zb), (1, 0, 0), (0, -s, c)),  # cara delantera
                ubicar((-x0, b, zb), (-1, 0, 0), (0, s, c)),  # cara trasera
            ],
        ),
    ]
    if p.con_base:
        piezas.append(Pieza("base", "Base", cara_rectangulo(L, F), e, [ubicar((x0, -F / 2, 0), (1, 0, 0), (0, 0, 1))]))
    return piezas


def avisos(p: ParametrosTareco) -> list[dict[str, str]]:
    return [
        {
            "nivel": "aviso",
            "codigo": "sin_plegado",
            "mensaje": (
                "El tareco suele doblarse en caliente de una sola lámina; aquí se arma con piezas planas "
                "pegadas (dos caras sobre dos laterales triangulares). Si se dobla, el despiece no aplica."
            ),
        }
    ]


TARECO = registrar(
    Plantilla(
        codigo="tareco",
        nombre="Tareco porta nombre",
        familia="tarecos",
        version=1,
        descripcion=(
            "Porta nombre de escritorio en V invertida, de doble cara, armado con piezas planas pegadas: "
            "dos caras inclinadas sobre dos laterales triangulares, con base opcional."
        ),
        modelo=ParametrosTareco,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.largo, p.fondo, p.alto),
        avisos=avisos,
    )
)
