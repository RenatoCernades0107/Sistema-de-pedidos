"""
Plantilla «letras»: letras corpóreas planas cortadas a partir de un texto.

Cada trazo cerrado del texto (una letra, o el acento suelto de una letra) es
una pieza con sus agujeros (los ojos de la «A», la «O», …). La fuente es
DejaVu Sans Bold (ver `formas.ruta_fuente`). El texto se escala para que el
conjunto de letras mida exactamente `alto_letra` en Y (de la base de la letra
más baja al tope de la más alta).

Convención de armado: las letras se modelan acostadas, con el espesor en Z,
tal como se leen (X a la derecha, Y hacia arriba).
  - Sin placa: las letras sueltas en z ∈ [0, e].
  - Con `con_placa`: una placa rectangular con `margen_placa` alrededor del
    texto, de `espesor_placa`, debajo; las letras van pegadas encima. Es la
    placa trasera de las letras retroiluminadas o el respaldo de un logotipo.

Las medidas exteriores dependen del texto: X sale de la fuente.
"""

from __future__ import annotations

from build123d import Location
from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_rectangulo, ubicar
from .formas import caras_texto, medidas_texto
from .registro import registrar


class ParametrosLetras(Parametros):
    texto: str = Field(
        "PLEXI", title="Texto", description="Las letras que se cortan.", min_length=1, max_length=40
    )
    alto_letra: float = Field(
        100, title="Alto de letra", description="Altura total del texto, en mm.", ge=10, le=1200
    )
    espesor: float = Field(5, title="Espesor", description="Grosor de las letras, en mm.", ge=1, le=30)
    con_placa: bool = Field(False, title="Con placa", description="Agrega una placa trasera bajo las letras.")
    margen_placa: float = Field(
        20, title="Margen de la placa", description="Borde de placa alrededor del texto, en mm.", ge=0, le=500
    )
    espesor_placa: float = Field(
        3, title="Espesor de la placa", description="Grosor de la placa trasera, en mm.", ge=1, le=30
    )

    def comprobar(self) -> list[tuple[str, str]]:
        if not self.texto.strip():
            return [("texto", "Escriba al menos una letra.")]
        return []


def medidas(p: ParametrosLetras) -> tuple[float, float, float]:
    ancho, alto = medidas_texto(p.texto.strip(), p.alto_letra)
    if p.con_placa:
        m = p.margen_placa
        return (ancho + 2 * m, alto + 2 * m, p.espesor + p.espesor_placa)
    return (ancho, alto, p.espesor)


def construir(p: ParametrosLetras) -> list[Pieza]:
    caras = caras_texto(p.texto.strip(), p.alto_letra)
    ancho, alto = medidas_texto(p.texto.strip(), p.alto_letra)
    m = p.margen_placa if p.con_placa else 0.0
    z = p.espesor_placa if p.con_placa else 0.0
    x0, y0 = -(ancho / 2 + m), -(alto / 2 + m)
    # de izquierda a derecha, para que «letra_1» sea la primera
    caras.sort(key=lambda c: (round(c.bounding_box().min.X, 3), c.bounding_box().min.Y))
    piezas = []
    for i, cara in enumerate(caras, start=1):
        bb = cara.bounding_box()
        # cada letra con su esquina en el origen: el DXF la acuesta igual
        local = cara.moved(Location((-bb.min.X, -bb.min.Y, 0)))
        origen = (x0 + m + bb.min.X, y0 + m + bb.min.Y, z)
        piezas.append(Pieza(f"letra_{i}", f"Letra {i}", local, p.espesor, [ubicar(origen, (1, 0, 0), (0, 0, 1))]))
    if p.con_placa:
        piezas.append(
            Pieza(
                "placa",
                "Placa trasera",
                cara_rectangulo(ancho + 2 * m, alto + 2 * m),
                p.espesor_placa,
                [ubicar((x0, y0, 0), (1, 0, 0), (0, 0, 1))],
            )
        )
    return piezas


LETRAS = registrar(
    Plantilla(
        codigo="letras",
        nombre="Letras corpóreas",
        familia="letras",
        version=1,
        descripcion="Letras planas cortadas a partir de un texto, con placa trasera opcional.",
        modelo=ParametrosLetras,
        construir=construir,
        dimensiones_esperadas=medidas,
    )
)
