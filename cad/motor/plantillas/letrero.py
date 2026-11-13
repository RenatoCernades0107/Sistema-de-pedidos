"""
Plantilla «letrero»: placa de letrero con esquinas redondeadas, agujeros de
fijación y texto grabado.

`ancho` (X) y `alto` (Y) son las medidas de la placa; el letrero se modela
acostado, con el espesor en Z (una o dos placas).

Convención de armado:
  - Placa frontal `ancho × alto` con esquinas de radio `radio_esquinas` (arcos
    reales en el DXF). Lleva el texto en la capa GRABADO, centrado, de
    `alto_texto` mm de alto (o menos, si así no entra entre márgenes).
  - Agujeros (0, 2 o 4) de `diametro_agujero` a `margen_agujero` de los bordes
    (centro del agujero): 2 = arriba a los costados, 4 = en las esquinas. Sirven
    para tornillos o para separadores (chapetones) de pared.
  - Con `doble_capa`, una placa trasera igual (sin grabado) pegada **debajo** de
    la frontal, con los mismos agujeros: el letrero de dos placas.
"""

from __future__ import annotations

from typing import Literal

from build123d import Edge, Location
from pydantic import Field

from .base import Parametros, Pieza, Plantilla, con_agujeros, ubicar
from .formas import cara_redondeada, caras_texto, circulo
from .registro import registrar


class ParametrosLetrero(Parametros):
    ancho: float = Field(200, title="Ancho", description="Ancho de la placa, en mm (eje X).", ge=20, le=2400)
    alto: float = Field(150, title="Alto", description="Alto de la placa, en mm (eje Y).", ge=20, le=1200)
    espesor: float = Field(3, title="Espesor", description="Grosor de cada placa, en mm.", ge=1, le=20)
    radio_esquinas: float = Field(
        10, title="Radio de las esquinas", description="Radio de las esquinas redondeadas, en mm (0 = vivas).", ge=0, le=300
    )
    texto: str = Field(
        "PLEXIACRIL",
        title="Texto",
        description="Texto que se graba en la placa. Vacío para no grabar nada.",
        max_length=60,
    )
    alto_texto: float = Field(
        30, title="Alto del texto", description="Altura máxima del texto grabado, en mm.", ge=3, le=1000
    )
    agujeros: Literal["0", "2", "4"] = Field(
        "4", title="Agujeros", description="Cantidad de agujeros de fijación: 0, 2 (arriba) o 4 (esquinas)."
    )
    diametro_agujero: float = Field(
        5, title="Diámetro de los agujeros", description="Diámetro de cada agujero, en mm.", ge=2, le=40
    )
    margen_agujero: float = Field(
        12,
        title="Margen de los agujeros",
        description="Distancia del centro de cada agujero a los bordes, en mm.",
        ge=3,
        le=200,
    )
    doble_capa: bool = Field(False, title="Doble capa", description="Agrega una placa trasera igual, pegada.")

    @property
    def centros(self) -> list[tuple[float, float]]:
        A, B, m = self.ancho, self.alto, self.margen_agujero
        if self.agujeros == "0":
            return []
        arriba = [(m, B - m), (A - m, B - m)]
        return arriba if self.agujeros == "2" else [(m, m), (A - m, m)] + arriba

    @property
    def margen_texto(self) -> float:
        """Franja libre a cada costado del texto: deja pasar los agujeros."""
        hay = self.agujeros != "0"
        return (self.margen_agujero + self.diametro_agujero) if hay else max(self.radio_esquinas / 2, 5)

    def comprobar(self) -> list[tuple[str, str]]:
        errores: list[tuple[str, str]] = []
        if 2 * self.radio_esquinas > min(self.ancho, self.alto):
            errores.append(("radio_esquinas", "El radio no puede pasar de la mitad del lado menor."))
        if self.agujeros != "0":
            r, m = self.diametro_agujero / 2, self.margen_agujero
            if m - r < self.espesor:
                errores.append(("margen_agujero", "Los agujeros quedan demasiado cerca del borde."))
            if 2 * m + 2 * r + self.espesor > min(self.ancho, self.alto):
                errores.append(("margen_agujero", "Los agujeros no entran en la placa."))
            # un agujero en una esquina redondeada debe quedar dentro del arco
            rr = self.radio_esquinas
            if rr > m and ((rr - m) * 2**0.5 + r) > rr - self.espesor:
                errores.append(("margen_agujero", "Con este radio de esquina los agujeros se salen de la placa."))
        if self.texto.strip() and self.ancho - 2 * self.margen_texto < 10:
            errores.append(("texto", "No queda espacio para el texto entre los agujeros."))
        if self.texto.strip() and self.alto_texto > self.alto - 2 * self.espesor:
            errores.append(("alto_texto", "El texto es más alto que la placa."))
        return errores


def grabado(p: ParametrosLetrero) -> list[Edge]:
    if not p.texto.strip():
        return []
    caras = caras_texto(p.texto.strip(), p.alto_texto, p.ancho - 2 * p.margen_texto)
    w = max(c.bounding_box().max.X for c in caras)
    h = max(c.bounding_box().max.Y for c in caras)
    mover = Location(((p.ancho - w) / 2, (p.alto - h) / 2, 0))
    return [arista.moved(mover) for cara in caras for arista in cara.edges()]


def construir(p: ParametrosLetrero) -> list[Pieza]:
    A, B, e = p.ancho, p.alto, p.espesor
    placa = con_agujeros(cara_redondeada(A, B, p.radio_esquinas), [circulo(x, y, p.diametro_agujero) for x, y in p.centros])
    x0, y0 = -A / 2, -B / 2
    z_frente = e if p.doble_capa else 0
    piezas = [
        Pieza("placa", "Placa frontal", placa, e, [ubicar((x0, y0, z_frente), (1, 0, 0), (0, 0, 1))], grabado=grabado(p))
    ]
    if p.doble_capa:
        piezas.append(Pieza("placa_trasera", "Placa trasera", placa, e, [ubicar((x0, y0, 0), (1, 0, 0), (0, 0, 1))]))
    return piezas


LETRERO = registrar(
    Plantilla(
        codigo="letrero",
        nombre="Letrero",
        familia="letreros",
        version=1,
        descripcion=(
            "Placa de letrero con esquinas redondeadas, agujeros de fijación, texto grabado y "
            "segunda placa opcional."
        ),
        modelo=ParametrosLetrero,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.ancho, p.alto, p.espesor * (2 if p.doble_capa else 1)),
    )
)
