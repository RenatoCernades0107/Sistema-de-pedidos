"""
Plantilla «anfora»: ánfora (urna de sorteo o votación) rectangular con ranura.

Las medidas `largo` (X), `ancho` (Y) y `alto` (Z) son exteriores e incluyen la
tapa: el conjunto armado mide exactamente largo × ancho × alto.

Convención de armado (cantos pegados a tope, como la caja «a_tope»):
  - La base es la plancha completa `largo × ancho`.
  - Frente y fondo miden `largo × (alto − 2e)` y van **sobre** la base; los
    laterales van **entre** ellos y miden `(ancho − 2e) × (alto − 2e)`.
  - La tapa es la plancha completa `largo × ancho` apoyada sobre las paredes,
    con la ranura centrada (puntas redondas: dos arcos reales en el DXF).
  - Con `tapa_desmontable` la tapa no se pega: lleva por debajo una pestaña
    que entra en la boca con `holgura_tapa` de juego por lado y repite la
    ranura. La «tapa bisagrada» del catálogo se fabrica así: la bisagra es un
    herraje y no se modela.
  - Con `con_cerradura` el frente lleva un agujero redondo para una cerradura
    de leva, centrado en el largo y a `diametro_cerradura` del borde superior.

No se modela el ánfora cilíndrica (ANF-003/007/008): su cuerpo es una lámina
curvada en caliente y no hay un equivalente honesto de piezas planas.
"""

from __future__ import annotations

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_rectangulo, con_agujeros, ubicar
from .formas import circulo, ranura
from .registro import registrar


class ParametrosAnfora(Parametros):
    largo: float = Field(250, title="Largo", description="Medida exterior de frente, en mm (eje X).", ge=60, le=1200)
    ancho: float = Field(250, title="Ancho", description="Medida exterior de fondo, en mm (eje Y).", ge=60, le=1200)
    alto: float = Field(
        250, title="Alto", description="Altura exterior en mm, incluida la tapa.", ge=60, le=1200
    )
    espesor: float = Field(3, title="Espesor", description="Grosor de la plancha, en mm.", ge=2, le=10)
    largo_ranura: float = Field(
        100, title="Largo de la ranura", description="Largo de la ranura de la tapa, en mm (eje X).", ge=10, le=1000
    )
    ancho_ranura: float = Field(
        10, title="Ancho de la ranura", description="Ancho de la ranura de la tapa, en mm.", ge=3, le=100
    )
    tapa_desmontable: bool = Field(
        False,
        title="Tapa desmontable",
        description="La tapa no se pega: lleva debajo una pestaña que entra en la boca del ánfora.",
    )
    holgura_tapa: float = Field(
        0.3,
        title="Holgura de la tapa",
        description="Juego por lado entre la pestaña de la tapa y las paredes, en mm.",
        ge=0,
        le=2,
    )
    con_cerradura: bool = Field(
        False, title="Con cerradura", description="Agujero en el frente para una cerradura de leva."
    )
    diametro_cerradura: float = Field(
        19, title="Diámetro de la cerradura", description="Diámetro del agujero de la cerradura, en mm.", ge=5, le=40
    )

    @property
    def margen_pestana(self) -> float:
        return self.espesor + self.holgura_tapa

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        for campo in ("largo", "ancho", "alto"):
            if getattr(self, campo) < 8 * e:
                errores.append((campo, f"Debe ser al menos 8 veces el espesor ({8 * e:g} mm)."))
        # la ranura (y la de la pestaña, si la hay) deja al menos 2e de material por lado
        borde = e + (self.margen_pestana if self.tapa_desmontable else 0)
        if self.largo_ranura > self.largo - 2 * (borde + 2 * e):
            errores.append(("largo_ranura", "La ranura es demasiado larga para el largo del ánfora."))
        if self.ancho_ranura > self.ancho - 2 * (borde + 2 * e):
            errores.append(("ancho_ranura", "La ranura es demasiado ancha para el ancho del ánfora."))
        if self.ancho_ranura > self.largo_ranura:
            errores.append(("ancho_ranura", "El ancho de la ranura no puede pasar de su largo."))
        if self.con_cerradura:
            d = self.diametro_cerradura
            if d > self.largo - 4 * e or 2.5 * d > self.alto - 2 * e:
                errores.append(("diametro_cerradura", "La cerradura no entra en el frente."))
        return errores


def construir(p: ParametrosAnfora) -> list[Pieza]:
    L, W, H, e = p.largo, p.ancho, p.alto, p.espesor
    hp = H - e  # cota superior de las paredes
    x0, y0 = -L / 2, -W / 2

    frente = cara_rectangulo(L, hp - e)
    if p.con_cerradura:
        frente = con_agujeros(frente, [circulo(L / 2, hp - e - p.diametro_cerradura, p.diametro_cerradura)])

    tapa = con_agujeros(cara_rectangulo(L, W), [ranura(L / 2, W / 2, p.largo_ranura, p.ancho_ranura)])
    ub_frente = ubicar((x0, y0 + e, e), (1, 0, 0), (0, -1, 0))
    ub_fondo = ubicar((x0, y0 + W, e), (1, 0, 0), (0, -1, 0))
    piezas = [Pieza("base", "Base", cara_rectangulo(L, W), e, [ubicar((x0, y0, 0), (1, 0, 0), (0, 0, 1))])]
    if p.con_cerradura:
        piezas += [
            Pieza("frente", "Frente con cerradura", frente, e, [ub_frente]),
            Pieza("fondo", "Fondo", cara_rectangulo(L, hp - e), e, [ub_fondo]),
        ]
    else:
        piezas.append(Pieza("frente", "Frente y fondo", frente, e, [ub_frente, ub_fondo]))
    piezas += [
        Pieza(
            "lateral",
            "Lateral",
            cara_rectangulo(W - 2 * e, hp - e),
            e,
            [ubicar((x0, y0 + e, e), (0, 1, 0), (1, 0, 0)), ubicar((x0 + L - e, y0 + e, e), (0, 1, 0), (1, 0, 0))],
        ),
        Pieza("tapa", "Tapa con ranura", tapa, e, [ubicar((x0, y0, hp), (1, 0, 0), (0, 0, 1))]),
    ]
    if p.tapa_desmontable:
        m = p.margen_pestana
        pestana = con_agujeros(
            cara_rectangulo(L - 2 * m, W - 2 * m), [ranura(L / 2 - m, W / 2 - m, p.largo_ranura, p.ancho_ranura)]
        )
        piezas.append(
            Pieza("pestana_tapa", "Pestaña de la tapa", pestana, e, [ubicar((x0 + m, y0 + m, hp - e), (1, 0, 0), (0, 0, 1))])
        )
    return piezas


ANFORA = registrar(
    Plantilla(
        codigo="anfora",
        nombre="Ánfora",
        familia="anforas",
        version=1,
        descripcion=(
            "Ánfora rectangular de piezas planas pegadas, con ranura en la tapa, tapa desmontable "
            "opcional y agujero para cerradura."
        ),
        modelo=ParametrosAnfora,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.largo, p.ancho, p.alto),
    )
)
