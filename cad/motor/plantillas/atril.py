"""
Plantilla «atril»: atril de mesa inclinado (menú, tablet o libro) de piezas planas.

`ancho` (X) y `alto` (Z) son exteriores; el fondo (Y) **sale** del ángulo y del
alto, y se informa en `dimensiones_esperadas`. El frente está en y = −fondo/2.

Geometría, en el perfil (y desde el frente, z hacia arriba), con θ = `angulo`
sobre la horizontal, u = (cos θ, sin θ) a lo largo del panel y n = (−sin θ,
cos θ) su normal hacia el lector:
  - Panel inclinado `ancho × Lp`: su cara trasera arranca en A0 = (y_A0, z_A0)
    y sube por u hasta el fondo del atril. z_A0 = zb + `alto_frente`, con zb = e
    si lleva base (0 si no).
  - Dos laterales, de canto en x ∈ [0, e] y [ancho − e, ancho]: cuadriláteros
    con la base en zb, el canto trasero vertical en el fondo y el canto
    superior a lo largo de la cara trasera del panel (el panel apoya en ellos).
  - Ceja opcional: una tira `ancho × (e + alto_ceja)` perpendicular al panel,
    pegada bajo su borde inferior y que sobresale `alto_ceja` por delante:
    sostiene la carta o el libro.
  - Base opcional: plancha `ancho × fondo` bajo todo lo demás.
Lp y y_A0 se eligen para que el punto más alto (esquina trasera de la cara
delantera del panel) quede en z = alto y el punto más adelantado en y = 0.

Muchos atriles de mesa se doblan en caliente de una sola lámina; aquí se arma
el equivalente de piezas planas pegadas y se avisa con `sin_plegado`.
"""

from __future__ import annotations

import math

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_poligono, cara_rectangulo, ubicar
from .registro import registrar


class ParametrosAtril(Parametros):
    ancho: float = Field(220, title="Ancho", description="Medida exterior de frente, en mm (eje X).", ge=60, le=1200)
    alto: float = Field(300, title="Alto", description="Altura exterior total, en mm (eje Z).", ge=60, le=1200)
    angulo: float = Field(
        65, title="Ángulo", description="Inclinación del panel sobre la horizontal, en grados.", ge=30, le=85
    )
    espesor: float = Field(3, title="Espesor", description="Grosor de la plancha, en mm.", ge=2, le=12)
    alto_frente: float = Field(
        20,
        title="Altura delantera",
        description="Altura del borde inferior del panel sobre la base (o la mesa), en mm.",
        ge=2,
        le=300,
    )
    con_ceja: bool = Field(True, title="Con ceja", description="Tira al pie del panel que sostiene la carta.")
    alto_ceja: float = Field(
        15, title="Alto de la ceja", description="Cuánto sobresale la ceja por delante del panel, en mm.", ge=3, le=80
    )
    con_base: bool = Field(True, title="Con base", description="Plancha de apoyo bajo el atril.")

    # --- geometría derivada (perfil y-z, frente en y = 0) ---

    @property
    def zb(self) -> float:
        return self.espesor if self.con_base else 0.0

    @property
    def seno(self) -> float:
        return math.sin(math.radians(self.angulo))

    @property
    def coseno(self) -> float:
        return math.cos(math.radians(self.angulo))

    @property
    def y_a0(self) -> float:
        e, s, c = self.espesor, self.seno, self.coseno
        return e * c + (e + self.alto_ceja) * s if self.con_ceja else e * s

    @property
    def z_a0(self) -> float:
        return self.zb + self.alto_frente

    @property
    def largo_panel(self) -> float:
        return (self.alto - self.espesor * self.coseno - self.z_a0) / self.seno

    @property
    def fondo(self) -> float:
        return self.y_a0 + self.largo_panel * self.coseno

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        if self.alto_frente < e:
            errores.append(("alto_frente", f"Debe ser al menos el espesor ({e:g} mm)."))
        if self.largo_panel < 4 * e:
            errores.append(("alto", "Con esta altura delantera el panel queda demasiado corto: aumente el alto."))
        if self.con_ceja and self.z_a0 + (e + self.alto_ceja) * self.coseno > self.alto - e:
            errores.append(("alto_ceja", "La ceja es demasiado alta para este atril."))
        if self.ancho < 5 * e:
            errores.append(("ancho", f"Debe ser al menos 5 veces el espesor ({5 * e:g} mm)."))
        return errores


def construir(p: ParametrosAtril) -> list[Pieza]:
    A, H, e, s, c = p.ancho, p.alto, p.espesor, p.seno, p.coseno
    F, Lp, ya, za, zb = p.fondo, p.largo_panel, p.y_a0, p.z_a0, p.zb
    x0, y0 = -A / 2, -F / 2
    lateral = cara_poligono([(ya, zb), (F, zb), (F, za + Lp * s), (ya, za)])
    piezas = [
        Pieza(
            "lateral",
            "Lateral",
            lateral,
            e,
            [ubicar((x0, y0, 0), (0, 1, 0), (1, 0, 0)), ubicar((x0 + A - e, y0, 0), (0, 1, 0), (1, 0, 0))],
        ),
        Pieza("panel", "Panel inclinado", cara_rectangulo(A, Lp), e, [ubicar((x0, y0 + ya, za), (1, 0, 0), (0, -s, c))]),
    ]
    if p.con_ceja:
        piezas.append(
            Pieza("ceja", "Ceja", cara_rectangulo(A, e + p.alto_ceja), e, [ubicar((x0, y0 + ya, za), (1, 0, 0), (0, -c, -s))])
        )
    if p.con_base:
        piezas.append(Pieza("base", "Base", cara_rectangulo(A, F), e, [ubicar((x0, y0, 0), (1, 0, 0), (0, 0, 1))]))
    return piezas


def avisos(p: ParametrosAtril) -> list[dict[str, str]]:
    return [
        {
            "nivel": "aviso",
            "codigo": "sin_plegado",
            "mensaje": (
                "Este atril se arma con piezas planas pegadas (laterales, panel y ceja). Si se prefiere "
                "doblado en caliente de una sola lámina, el despiece no aplica."
            ),
        }
    ]


ATRIL = registrar(
    Plantilla(
        codigo="atril",
        nombre="Atril de mesa",
        familia="atriles",
        version=1,
        descripcion=(
            "Atril de mesa de piezas planas pegadas: panel inclinado sobre dos laterales, con ceja "
            "y base opcionales y ángulo a elección."
        ),
        modelo=ParametrosAtril,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.ancho, p.fondo, p.alto),
        avisos=avisos,
    )
)
