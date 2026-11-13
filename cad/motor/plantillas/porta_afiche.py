"""
Plantilla «porta_afiche»: un panel vertical pegado sobre una base plana.

Las medidas `ancho` (X), `fondo` (Y) y `alto` (Z) son exteriores.

Convención de armado (cantos pegados a tope):
  - La base es la plancha completa `ancho × fondo`, acostada.
  - El panel mide `ancho × (alto − e)` y va de canto **sobre** la base:
      · base en «L»: al ras del borde trasero de la base.
      · base en «T»: centrado en el fondo de la base.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_rectangulo, ubicar
from .registro import registrar


class ParametrosPortaAfiche(Parametros):
    ancho: float = Field(210, title="Ancho", description="Ancho del panel y de la base, en mm (eje X).", ge=30, le=2400)
    alto: float = Field(300, title="Alto", description="Altura exterior en mm, incluida la base.", ge=30, le=1200)
    fondo: float = Field(80, title="Fondo", description="Profundidad de la base, en mm (eje Y).", ge=10, le=1200)
    espesor: float = Field(3, title="Espesor", description="Grosor de la plancha, en mm.", ge=1, le=30)
    tipo_base: Literal["L", "T"] = Field(
        "L",
        title="Tipo de base",
        description="«L»: el panel va al borde trasero de la base. «T»: va al centro de la base.",
    )

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        if self.fondo < 3 * e:
            errores.append(("fondo", f"Debe ser al menos 3 veces el espesor ({3 * e:g} mm)."))
        if self.alto < 3 * e:
            errores.append(("alto", f"Con este espesor el alto mínimo es {3 * e:g} mm."))
        return errores


def construir(p: ParametrosPortaAfiche) -> list[Pieza]:
    A, H, F, e = p.ancho, p.alto, p.fondo, p.espesor
    x0, y0 = -A / 2, -F / 2
    # cara trasera del panel: el espesor crece hacia −Y desde ahí
    y_panel = y0 + F if p.tipo_base == "L" else y0 + (F + e) / 2
    return [
        Pieza("base", "Base", cara_rectangulo(A, F), e, [ubicar((x0, y0, 0), (1, 0, 0), (0, 0, 1))]),
        Pieza("panel", "Panel", cara_rectangulo(A, H - e), e, [ubicar((x0, y_panel, e), (1, 0, 0), (0, -1, 0))]),
    ]


PORTA_AFICHE = registrar(
    Plantilla(
        codigo="porta_afiche",
        nombre="Porta afiche",
        familia="porta_afiches",
        version=1,
        descripcion="Porta afiche de dos piezas planas pegadas: un panel vertical sobre una base en L o en T.",
        modelo=ParametrosPortaAfiche,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.ancho, p.fondo, p.alto),
    )
)
