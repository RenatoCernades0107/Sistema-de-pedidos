"""
Plantilla «display»: exhibidor escalonado de mostrador con `niveles` gradas.

Las medidas `ancho` (X), `fondo` (Y) y `alto` (Z) son exteriores; el alto
incluye la ceja del último nivel si la lleva. El frente está en y = −fondo/2.

Convención de armado (cantos pegados a tope):
  - Dos laterales de perfil escalonado, de canto, en x ∈ [0, e] y [ancho − e, ancho].
    El perfil sube en `niveles` gradas iguales: la grada i (0 = la delantera,
    la más baja) empieza en y_i = i·d, con d = (fondo − e)/niveles, y su cara
    superior está en z_i = (i + 1)·h, con h = (alto − ceja)/niveles.
  - Los estantes van **entre** los laterales (`ancho − 2e`): el estante i
    ocupa z ∈ [z_i − e, z_i] y llega desde y_i hasta el respaldo.
  - El respaldo va entre los laterales, en el fondo, y sube hasta el último
    estante.
  - Ceja opcional: una tira de alto `alto_ceja` pegada **sobre** el borde
    delantero de cada estante (y ∈ [y_i, y_i + e]) para que nada resbale.
"""

from __future__ import annotations

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_poligono, cara_rectangulo, ubicar
from .registro import registrar


class ParametrosDisplay(Parametros):
    ancho: float = Field(200, title="Ancho", description="Medida exterior de frente, en mm (eje X).", ge=40, le=2400)
    fondo: float = Field(150, title="Fondo", description="Profundidad exterior, en mm (eje Y).", ge=30, le=1200)
    alto: float = Field(
        150, title="Alto", description="Altura exterior en mm, incluida la ceja del último nivel.", ge=20, le=1200
    )
    niveles: int = Field(3, title="Niveles", description="Cantidad de gradas o estantes.", ge=1, le=10)
    espesor: float = Field(3, title="Espesor", description="Grosor de la plancha, en mm.", ge=1, le=20)
    con_ceja: bool = Field(
        False, title="Con ceja", description="Agrega una tira en el borde delantero de cada estante."
    )
    alto_ceja: float = Field(
        10, title="Alto de la ceja", description="Altura de la ceja sobre el estante, en mm.", ge=3, le=100
    )

    @property
    def ceja(self) -> float:
        return self.alto_ceja if self.con_ceja else 0.0

    @property
    def paso_y(self) -> float:
        return (self.fondo - self.espesor) / self.niveles

    @property
    def paso_z(self) -> float:
        return (self.alto - self.ceja) / self.niveles

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        if self.ancho < 5 * e:
            errores.append(("ancho", f"Debe ser al menos 5 veces el espesor ({5 * e:g} mm)."))
        if self.paso_y < 3 * e:
            errores.append(("niveles", "Con este fondo cada grada queda de menos de 3 espesores: use menos niveles."))
        if self.paso_z < 2 * e:
            errores.append(("niveles", "Con este alto cada grada queda de menos de 2 espesores: use menos niveles."))
        if self.con_ceja and self.alto_ceja > self.paso_z - e:
            errores.append(("alto_ceja", "La ceja no puede ser más alta que una grada."))
        return errores


def perfil(p: ParametrosDisplay) -> list[tuple[float, float]]:
    """Vértices del perfil escalonado en (y, z), con el frente en y = 0."""
    n, d, h = p.niveles, p.paso_y, p.paso_z
    pts = [(0.0, 0.0), (p.fondo, 0.0), (p.fondo, n * h)]
    for i in range(n - 1, -1, -1):
        pts.append((i * d, (i + 1) * h))
        pts.append((i * d, i * h))
    return pts


def construir(p: ParametrosDisplay) -> list[Pieza]:
    A, D, e, n, d, h = p.ancho, p.fondo, p.espesor, p.niveles, p.paso_y, p.paso_z
    x0, y0 = -A / 2, -D / 2
    piezas = [
        Pieza(
            "lateral",
            "Lateral escalonado",
            cara_poligono(perfil(p)),
            e,
            [ubicar((x0, y0, 0), (0, 1, 0), (1, 0, 0)), ubicar((x0 + A - e, y0, 0), (0, 1, 0), (1, 0, 0))],
        ),
        Pieza("respaldo", "Respaldo", cara_rectangulo(A - 2 * e, n * h), e, [ubicar((x0 + e, y0 + D, 0), (1, 0, 0), (0, -1, 0))]),
    ]
    for i in range(n):
        piezas.append(
            Pieza(
                f"estante_{i + 1}",
                f"Estante {i + 1}",
                cara_rectangulo(A - 2 * e, D - e - i * d),
                e,
                [ubicar((x0 + e, y0 + i * d, (i + 1) * h - e), (1, 0, 0), (0, 0, 1))],
            )
        )
    if p.con_ceja:
        piezas.append(
            Pieza(
                "ceja",
                "Ceja",
                cara_rectangulo(A - 2 * e, p.alto_ceja),
                e,
                [ubicar((x0 + e, y0 + i * d + e, (i + 1) * h), (1, 0, 0), (0, -1, 0)) for i in range(n)],
            )
        )
    return piezas


DISPLAY = registrar(
    Plantilla(
        codigo="display",
        nombre="Display escalonado",
        familia="displays",
        version=1,
        descripcion=(
            "Display de mostrador en gradas, de piezas planas pegadas: dos laterales escalonados, "
            "estantes, respaldo y ceja opcional en cada estante."
        ),
        modelo=ParametrosDisplay,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.ancho, p.fondo, p.alto),
    )
)
