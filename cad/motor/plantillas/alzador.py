"""
Plantilla «alzador»: un puente en U de tres piezas planas (tapa y dos patas).

Las medidas `largo` (X), `ancho` (Y) y `alto` (Z) son exteriores.

Convención de armado (cantos pegados a tope):
  - La tapa es la plancha completa `largo × ancho` y va **encima** de las patas.
  - Las dos patas miden `ancho × (alto − e)` y van de canto, paralelas al
    ancho, a `retiro_patas` mm de cada extremo del largo (0 = al ras).
"""

from __future__ import annotations

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_rectangulo, ubicar
from .registro import registrar


class ParametrosAlzador(Parametros):
    largo: float = Field(250, title="Largo", description="Medida exterior de frente, en mm (eje X).", ge=30, le=2400)
    ancho: float = Field(120, title="Ancho", description="Medida exterior de fondo, en mm (eje Y).", ge=20, le=1200)
    alto: float = Field(80, title="Alto", description="Altura exterior en mm, incluida la tapa.", ge=10, le=1200)
    espesor: float = Field(4, title="Espesor", description="Grosor de la plancha, en mm.", ge=1, le=30)
    retiro_patas: float = Field(
        0,
        title="Retiro de las patas",
        description="Distancia de cada pata al extremo de la tapa, en mm. Con 0 quedan al ras.",
        ge=0,
        le=1000,
    )

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        if self.alto < 3 * e:
            errores.append(("alto", f"Con este espesor el alto mínimo es {3 * e:g} mm."))
        if self.ancho < 2 * e:
            errores.append(("ancho", f"Debe ser al menos 2 veces el espesor ({2 * e:g} mm)."))
        libre = self.largo - 2 * (self.retiro_patas + e)
        if libre < 2 * e:
            errores.append(
                ("retiro_patas", "Las patas quedan demasiado juntas: reduzca el retiro o aumente el largo.")
            )
        return errores


def construir(p: ParametrosAlzador) -> list[Pieza]:
    L, W, H, e, r = p.largo, p.ancho, p.alto, p.espesor, p.retiro_patas
    x0, y0 = -L / 2, -W / 2
    return [
        Pieza("tapa", "Tapa", cara_rectangulo(L, W), e, [ubicar((x0, y0, H - e), (1, 0, 0), (0, 0, 1))]),
        Pieza(
            "pata",
            "Pata",
            cara_rectangulo(W, H - e),
            e,
            [
                ubicar((x0 + r, y0, 0), (0, 1, 0), (1, 0, 0)),
                ubicar((x0 + L - r - e, y0, 0), (0, 1, 0), (1, 0, 0)),
            ],
        ),
    ]


ALZADOR = registrar(
    Plantilla(
        codigo="alzador",
        nombre="Alzador",
        familia="alzadores",
        version=1,
        descripcion="Alzador en U de tres piezas planas pegadas: una tapa sobre dos patas.",
        modelo=ParametrosAlzador,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.largo, p.ancho, p.alto),
    )
)
