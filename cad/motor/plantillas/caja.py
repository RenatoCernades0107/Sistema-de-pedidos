"""
Plantilla «caja»: caja rectangular de piezas planas.

Las medidas `largo` (X), `ancho` (Y) y `alto` (Z) son **exteriores** y el alto
**incluye la tapa** cuando la hay: el conjunto armado mide exactamente
largo × ancho × alto. Todas las piezas se calculan a partir del espesor `e`.

Convención de armado
--------------------
Llamamos `hp` a la cota superior de las paredes: `alto` sin tapa, `alto − e`
con tapa.

Unión **a tope** (cantos pegados):
  - La base es la plancha completa `largo × ancho`.
  - Las paredes se apoyan **sobre** la base, así que miden `hp − e` de alto.
  - Frente y fondo ocupan todo el largo; los laterales van **entre** ellos y
    miden `ancho − 2e`.

Unión de **encastre** (dedos):
  - Base, frente/fondo y laterales se dibujan sobre su rectángulo completo
    (`largo × ancho`, `largo × hp`, `ancho × hp`) y se reparten las franjas de
    grosor `e` que comparten:
      · arista base–pared: `n` tramos iguales a lo largo de la parte interior
        (`longitud − 2e`); los pares (los de los extremos) son dedos de la
        pared, los impares son dedos de la base.
      · arista vertical frente–lateral: `m` tramos iguales entre `z = e` y
        `z = hp`; los pares (abajo y arriba) son del frente/fondo, los impares
        del lateral.
      · los cuatro cubitos `e × e × e` de las esquinas inferiores son del
        lateral (alargan su primer y su último dedo de abajo).
  - `n` y `m` son impares (mínimo 3), los más cercanos al `ancho_dedo` pedido.
  - El borde superior de las paredes es liso.

Tapa (opcional): una plancha `largo × ancho` apoyada sobre las paredes. Con
`tipo_tapa = "con_pestana"` lleva pegada por debajo una segunda plancha que
entra en la boca de la caja con `holgura_tapa` de juego por lado y evita que
la tapa se corra.

Ranura (opcional, `ranura`): de puntas redondas (dos arcos reales en el DXF) y
centrada. En la «tapa» exige `con_tapa` y atraviesa también la pestaña. En el
«frente» va centrada en la cara que queda a la vista sobre la base; el fondo
sigue liso. Alcancías, cajas de sugerencias y de sorteo (CAJ-005, CAJ-006).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .base import Parametros, Pieza, Plantilla, cara_rectangulo, con_agujeros, ubicar
from .dentado import contorno_dentado, numero_dedos, tramos_alternos
from .formas import ranura as forma_ranura
from .registro import registrar


class ParametrosCaja(Parametros):
    largo: float = Field(
        200, title="Largo", description="Medida exterior de frente, en mm (eje X).", ge=20, le=2400
    )
    ancho: float = Field(
        150, title="Ancho", description="Medida exterior de fondo, en mm (eje Y).", ge=20, le=2400
    )
    alto: float = Field(
        100, title="Alto", description="Altura exterior en mm, incluida la tapa si la lleva.", ge=10, le=1200
    )
    espesor: float = Field(3, title="Espesor", description="Grosor de la plancha, en mm.", ge=1, le=30)
    tipo_union: Literal["a_tope", "encastre"] = Field(
        "a_tope",
        title="Tipo de unión",
        description="«a_tope»: cantos lisos pegados. «encastre»: dedos que encajan entre piezas.",
    )
    ancho_dedo: float = Field(
        15,
        title="Ancho del dedo",
        description="Ancho aproximado de cada dedo del encastre, en mm. Solo se usa con unión de encastre.",
        ge=3,
        le=200,
    )
    con_tapa: bool = Field(False, title="Con tapa", description="Agrega una tapa suelta encima de la caja.")
    tipo_tapa: Literal["simple", "con_pestana"] = Field(
        "simple",
        title="Tipo de tapa",
        description="«simple»: plancha apoyada. «con_pestana»: lleva debajo una plancha que entra en la boca.",
    )
    holgura_tapa: float = Field(
        0.2,
        title="Holgura de la tapa",
        description="Juego por lado entre la pestaña de la tapa y las paredes, en mm.",
        ge=0,
        le=2,
    )
    ranura: Literal["ninguna", "tapa", "frente"] = Field(
        "ninguna",
        title="Ranura",
        description="«tapa»: ranura centrada en la tapa (necesita tapa). «frente»: centrada en el frente.",
    )
    largo_ranura: float = Field(
        100, title="Largo de la ranura", description="Largo total de la ranura, en mm (eje X).", ge=10, le=1000
    )
    ancho_ranura: float = Field(
        10, title="Ancho de la ranura", description="Ancho de la ranura, en mm.", ge=3, le=100
    )

    @property
    def margen_pestana(self) -> float:
        """Cuánto entra la pestaña de la tapa desde el borde exterior."""
        return self.espesor + self.holgura_tapa

    @property
    def alto_frente(self) -> float:
        """Alto de la parte del frente que queda a la vista sobre la base."""
        return self.cota_paredes - self.espesor

    @property
    def cota_paredes(self) -> float:
        """Altura (z) a la que terminan las paredes."""
        return self.alto - (self.espesor if self.con_tapa else 0)

    def comprobar(self) -> list[tuple[str, str]]:
        e = self.espesor
        errores: list[tuple[str, str]] = []
        for campo in ("largo", "ancho"):
            if getattr(self, campo) < 5 * e:
                errores.append((campo, f"Debe ser al menos 5 veces el espesor ({5 * e:g} mm)."))
        minimo = (4 if self.con_tapa else 3) * e
        if self.alto < minimo:
            errores.append(("alto", f"Con este espesor el alto mínimo es {minimo:g} mm."))
        if self.ranura != "ninguna":
            errores += self._comprobar_ranura()
        return errores

    def _comprobar_ranura(self) -> list[tuple[str, str]]:
        """La ranura deja al menos 2e de material hasta lo que tenga alrededor."""
        e = self.espesor
        if self.ranura == "tapa" and not self.con_tapa:
            return [("ranura", "La ranura en la tapa necesita una caja con tapa.")]
        if self.ranura == "tapa":
            # Bajo la tapa están las paredes (o la pestaña, que entra más).
            borde = self.margen_pestana if self.tipo_tapa == "con_pestana" else e
            largo_libre = self.largo - 2 * (borde + 2 * e)
            ancho_libre = self.ancho - 2 * (borde + 2 * e)
        else:
            largo_libre = self.largo - 2 * (e + 2 * e)
            ancho_libre = self.alto_frente - 2 * 2 * e
        errores = []
        if self.largo_ranura > largo_libre:
            errores.append(("largo_ranura", f"La ranura es demasiado larga: como mucho {max(largo_libre, 0):g} mm."))
        if self.ancho_ranura > ancho_libre:
            errores.append(("ancho_ranura", f"La ranura es demasiado ancha: como mucho {max(ancho_libre, 0):g} mm."))
        if self.ancho_ranura > self.largo_ranura:
            errores.append(("ancho_ranura", "El ancho de la ranura no puede pasar de su largo."))
        return errores


def _centro(p: ParametrosCaja, x: float, y: float, z: float) -> tuple[float, float, float]:
    """Del sistema con origen en la esquina de la caja al del conjunto (centrado en XY, apoyado en z=0)."""
    return (x - p.largo / 2, y - p.ancho / 2, z)


def _ubicaciones_paredes(p: ParametrosCaja, z: float, x_lateral: float, y_lateral: float):
    """Dónde van frente/fondo y los dos laterales, con su base en la cota `z`."""
    L, W, e = p.largo, p.ancho, p.espesor
    frente = [
        ubicar(_centro(p, 0, e, z), (1, 0, 0), (0, -1, 0)),  # ocupa y ∈ [0, e]
        ubicar(_centro(p, 0, W, z), (1, 0, 0), (0, -1, 0)),  # ocupa y ∈ [W − e, W]
    ]
    lateral = [
        ubicar(_centro(p, x_lateral, y_lateral, z), (0, 1, 0), (1, 0, 0)),  # x ∈ [0, e]
        ubicar(_centro(p, L - e - x_lateral, y_lateral, z), (0, 1, 0), (1, 0, 0)),  # x ∈ [L − e, L]
    ]
    return frente, lateral


def _piezas_a_tope(p: ParametrosCaja) -> list[Pieza]:
    L, W, e, hp = p.largo, p.ancho, p.espesor, p.cota_paredes
    frente, lateral = _ubicaciones_paredes(p, z=e, x_lateral=0, y_lateral=e)
    return [
        Pieza("base", "Base", cara_rectangulo(L, W), e, [ubicar(_centro(p, 0, 0, 0), (1, 0, 0), (0, 0, 1))]),
        Pieza("frente", "Frente y fondo", cara_rectangulo(L, hp - e), e, frente),
        Pieza("lateral", "Lateral", cara_rectangulo(W - 2 * e, hp - e), e, lateral),
    ]


def _piezas_encastre(p: ParametrosCaja) -> list[Pieza]:
    L, W, e, hp = p.largo, p.ancho, p.espesor, p.cota_paredes
    n_l = numero_dedos(L - 2 * e, p.ancho_dedo)
    n_w = numero_dedos(W - 2 * e, p.ancho_dedo)
    m = numero_dedos(hp - e, p.ancho_dedo)

    # Base: en cada lado, dedos en los tramos impares; las cuatro esquinas son ajenas.
    lado_l = tramos_alternos(e, L - e, n_l, fuera_pares=False)
    lado_w = tramos_alternos(e, W - e, n_w, fuera_pares=False)
    base = contorno_dentado(
        L, W, e,
        abajo=lado_l, derecha=lado_w, arriba=lado_l, izquierda=lado_w,
        esquinas_ajenas=("abajo_izq", "abajo_der", "arriba_der", "arriba_izq"),
    )

    # Frente/fondo: abajo los tramos pares; en las aristas verticales también los pares.
    vertical_frente = tramos_alternos(e, hp, m, fuera_pares=True)
    frente = contorno_dentado(
        L, hp, e,
        abajo=tramos_alternos(e, L - e, n_l, fuera_pares=True),
        derecha=vertical_frente,
        arriba=[(0, L, True)],
        izquierda=vertical_frente,
        esquinas_ajenas=("abajo_izq", "abajo_der"),
    )

    # Lateral: abajo los tramos pares más las dos esquinas; en vertical los impares.
    vertical_lateral = [(0, e, True)] + tramos_alternos(e, hp, m, fuera_pares=False)
    lateral = contorno_dentado(
        W, hp, e,
        abajo=[(0, e, True)] + tramos_alternos(e, W - e, n_w, fuera_pares=True) + [(W - e, W, True)],
        derecha=vertical_lateral,
        arriba=[(e, W - e, True)],
        izquierda=vertical_lateral,
    )

    ub_frente, ub_lateral = _ubicaciones_paredes(p, z=0, x_lateral=0, y_lateral=0)
    return [
        Pieza("base", "Base", base, e, [ubicar(_centro(p, 0, 0, 0), (1, 0, 0), (0, 0, 1))]),
        Pieza("frente", "Frente y fondo", frente, e, ub_frente),
        Pieza("lateral", "Lateral", lateral, e, ub_lateral),
    ]


def _piezas_tapa(p: ParametrosCaja) -> list[Pieza]:
    L, W, e, hp = p.largo, p.ancho, p.espesor, p.cota_paredes
    piezas = [
        Pieza(
            "tapa",
            "Tapa con ranura" if p.ranura == "tapa" else "Tapa",
            _con_ranura(p, cara_rectangulo(L, W), L / 2, W / 2, "tapa"),
            e,
            [ubicar(_centro(p, 0, 0, hp), (1, 0, 0), (0, 0, 1))],
        )
    ]
    if p.tipo_tapa == "con_pestana":
        margen = p.margen_pestana
        piezas.append(
            Pieza(
                "pestana_tapa",
                "Pestaña de la tapa",
                _con_ranura(p, cara_rectangulo(L - 2 * margen, W - 2 * margen), L / 2 - margen, W / 2 - margen, "tapa"),
                e,
                [ubicar(_centro(p, margen, margen, hp - e), (1, 0, 0), (0, 0, 1))],
            )
        )
    return piezas


def _con_ranura(p: ParametrosCaja, cara, cx: float, cy: float, donde: str):
    if p.ranura != donde:
        return cara
    return con_agujeros(cara, [forma_ranura(cx, cy, p.largo_ranura, p.ancho_ranura)])


def _ranura_en_frente(p: ParametrosCaja, piezas: list[Pieza]) -> list[Pieza]:
    """Separa frente y fondo: solo el frente (la primera ubicación) lleva la ranura."""
    salida = []
    for pieza in piezas:
        if pieza.id != "frente":
            salida.append(pieza)
            continue
        # En el encastre la cara empieza en z=0 (dedos dentro de la base); a tope, sobre ella.
        z0 = p.espesor if p.tipo_union == "encastre" else 0
        cy = z0 + p.alto_frente / 2
        frente = _con_ranura(p, pieza.contorno, p.largo / 2, cy, "frente")
        salida.append(Pieza("frente", "Frente con ranura", frente, pieza.espesor_mm, pieza.ubicaciones[:1]))
        salida.append(Pieza("fondo", "Fondo", pieza.contorno, pieza.espesor_mm, pieza.ubicaciones[1:]))
    return salida


def construir(p: ParametrosCaja) -> list[Pieza]:
    piezas = _piezas_encastre(p) if p.tipo_union == "encastre" else _piezas_a_tope(p)
    if p.ranura == "frente":
        piezas = _ranura_en_frente(p, piezas)
    if p.con_tapa:
        piezas += _piezas_tapa(p)
    return piezas


def avisos(p: ParametrosCaja) -> list[dict[str, str]]:
    if p.tipo_union != "encastre":
        return []
    e = p.espesor
    tramos = {
        "largo": p.largo - 2 * e,
        "ancho": p.ancho - 2 * e,
        "alto": p.cota_paredes - e,
    }
    salida = []
    for nombre, longitud in tramos.items():
        dedo = longitud / numero_dedos(longitud, p.ancho_dedo)
        if dedo < e - 1e-9:
            salida.append(
                {
                    "nivel": "aviso",
                    "codigo": "dedo_angosto",
                    "mensaje": (
                        f"Los dedos a lo largo del {nombre} salen de {dedo:.1f} mm, más angostos que el "
                        f"espesor ({e:g} mm): son frágiles. Aumente el ancho del dedo."
                    ),
                }
            )
    return salida


CAJA = registrar(
    Plantilla(
        codigo="caja",
        nombre="Caja",
        familia="cajas",
        version=1,
        descripcion="Caja rectangular de piezas planas, pegada a tope o con encastres, con tapa opcional.",
        modelo=ParametrosCaja,
        construir=construir,
        dimensiones_esperadas=lambda p: (p.largo, p.ancho, p.alto),
        avisos=avisos,
    )
)
