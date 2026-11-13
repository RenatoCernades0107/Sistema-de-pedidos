"""
Marco de las plantillas.

Una plantilla es un modelo de parámetros (pydantic, solo campos planos) más una
función que devuelve una lista de **piezas**. Una pieza es un contorno plano en
el plano XY —exactamente lo que va a cortar el láser, con sus agujeros y
ranuras—, un espesor y una o más **ubicaciones** que colocan la pieza ya
extruida dentro del producto armado.

De esa única lista sale todo lo demás (`Diseno`): el modelo 3D armado (cada
contorno extruido por su espesor y puesto en su ubicación), el despiece plano,
el DXF y el STEP. Como el 3D se construye a partir del mismo contorno que se
corta, el render y el archivo de corte no pueden contradecirse.

Convenciones:
  - Todo en milímetros.
  - El contorno vive en XY y se extruye hacia +Z local, de z=0 a z=espesor.
  - La ubicación (`Location` de build123d) lleva ese sólido local a su sitio en
    el conjunto armado. El conjunto usa Z hacia arriba.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from typing import Any, Callable, ClassVar, Iterable, Sequence

from build123d import Edge, Face, Location, Plane, Solid, Vector, Wire
from pydantic import BaseModel, ConfigDict

FAMILIAS = (
    "anforas",
    "cajas",
    "displays",
    "porta_afiches",
    "letras",
    "alzadores",
    "tarecos",
    "letreros",
    "atriles",
)

#: Decimales con los que se informan las medidas (milésima de mm).
DECIMALES = 3


def redondear(valor: float) -> float:
    r = round(float(valor), DECIMALES)
    return 0.0 if r == 0 else r


# --------------------------------------------------------------------------
# Parámetros
# --------------------------------------------------------------------------


class ErrorParametros(Exception):
    """Parámetros que no cumplen las reglas de la plantilla (→ 422)."""

    def __init__(self, errores: list[dict[str, str]], mensaje: str | None = None):
        self.errores = errores
        self.mensaje = mensaje or "Los parámetros no son válidos."
        super().__init__(self.mensaje)


class Parametros(BaseModel):
    """
    Base de los parámetros de una plantilla.

    Solo campos planos: `float`, `int`, `bool` o `Literal[...]` de textos, cada
    uno con `title`, `description`, `default` y, si aplica, `ge`/`le`. El
    registro lo comprueba al registrar la plantilla.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    def comprobar(self) -> list[tuple[str, str]]:
        """Reglas que cruzan varios campos. Devuelve pares (campo, mensaje)."""
        return []


# --------------------------------------------------------------------------
# Geometría plana: ayudas para dibujar contornos
# --------------------------------------------------------------------------

Punto = tuple[float, float]


def limpiar_poligono(puntos: Sequence[Punto], tol: float = 1e-7) -> list[Punto]:
    """Quita puntos repetidos y los que caen en medio de un tramo recto."""
    pts: list[Punto] = []
    for p in puntos:
        if not pts or abs(p[0] - pts[-1][0]) > tol or abs(p[1] - pts[-1][1]) > tol:
            pts.append((float(p[0]), float(p[1])))
    while len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) <= tol and abs(pts[0][1] - pts[-1][1]) <= tol:
        pts.pop()
    cambio = True
    while cambio and len(pts) > 3:
        cambio = False
        n = len(pts)
        for i in range(n):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
            cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cruz) <= tol:
                del pts[i]
                cambio = True
                break
    return pts


def cara_poligono(puntos: Sequence[Punto]) -> Face:
    """Cara plana en XY a partir de los vértices de un polígono cerrado."""
    pts = limpiar_poligono(puntos)
    if len(pts) < 3:
        raise ValueError("Un contorno necesita al menos tres vértices.")
    cara = Face(Wire.make_polygon([Vector(x, y, 0) for x, y in pts], close=True))
    return orientar(cara)


def cara_rectangulo(ancho: float, alto: float) -> Face:
    """Rectángulo con una esquina en el origen."""
    return cara_poligono([(0, 0), (ancho, 0), (ancho, alto), (0, alto)])


def orientar(cara: Face) -> Face:
    """Devuelve la cara con la normal hacia +Z."""
    if cara.normal_at().Z < 0:
        cara = -cara
    return cara


def con_agujeros(cara: Face, agujeros: Iterable[Wire]) -> Face:
    """La misma cara con contornos interiores (agujeros o ranuras)."""
    return orientar(Face(cara.outer_wire(), list(cara.inner_wires()) + list(agujeros)))


def ubicar(origen: Sequence[float], dir_u: Sequence[float], dir_normal: Sequence[float]) -> Location:
    """
    Ubicación de una pieza: su origen local va a `origen`, su eje X local (el
    ancho del contorno) apunta a `dir_u` y su espesor crece hacia `dir_normal`.
    El eje Y local (el alto del contorno) queda en `dir_normal × dir_u`.
    """
    return Plane(origin=tuple(origen), x_dir=tuple(dir_u), z_dir=tuple(dir_normal)).location


# --------------------------------------------------------------------------
# Piezas
# --------------------------------------------------------------------------


@dataclass
class Pieza:
    """Una pieza plana y dónde va en el producto armado."""

    id: str
    nombre: str
    contorno: Face
    espesor_mm: float
    ubicaciones: list[Location] = field(default_factory=lambda: [Location()])
    #: Trazos de grabado, en las mismas coordenadas XY del contorno.
    grabado: list[Edge] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.ubicaciones:
            raise ValueError(f"La pieza «{self.id}» no tiene ninguna ubicación.")
        if self.espesor_mm <= 0:
            raise ValueError(f"La pieza «{self.id}» tiene espesor no positivo.")
        self.contorno = orientar(self.contorno)

    @property
    def cantidad(self) -> int:
        return len(self.ubicaciones)

    @cached_property
    def caja_plana(self) -> tuple[float, float, float, float]:
        """(xmin, ymin, xmax, ymax) del contorno acostado."""
        bb = self.contorno.bounding_box()
        return (bb.min.X, bb.min.Y, bb.max.X, bb.max.Y)

    @property
    def ancho_mm(self) -> float:
        x0, _, x1, _ = self.caja_plana
        return x1 - x0

    @property
    def alto_mm(self) -> float:
        _, y0, _, y1 = self.caja_plana
        return y1 - y0

    @property
    def area_mm2(self) -> float:
        return self.contorno.area

    @property
    def perimetro_mm(self) -> float:
        """Largo total de corte: contorno exterior más los interiores."""
        return self.contorno.outer_wire().length + sum(w.length for w in self.contorno.inner_wires())

    @cached_property
    def solido_local(self) -> Solid:
        """El contorno extruido por el espesor, sin ubicar."""
        return Solid.extrude(self.contorno, Vector(0, 0, self.espesor_mm))

    def nombres_nodo(self) -> list[str]:
        """`<id>` si va una vez; `<id>_<n>` (desde 1) si se repite."""
        if self.cantidad == 1:
            return [self.id]
        return [f"{self.id}_{n}" for n in range(1, self.cantidad + 1)]


@dataclass
class Instancia:
    """Una pieza colocada en el conjunto armado."""

    nombre: str
    pieza: Pieza
    solido: Solid


# --------------------------------------------------------------------------
# Plantilla y diseño
# --------------------------------------------------------------------------


@dataclass
class Plantilla:
    codigo: str
    nombre: str
    familia: str
    version: int
    descripcion: str
    modelo: type[Parametros]
    construir: Callable[[Any], list[Pieza]]
    #: Medidas exteriores (x, y, z) que debe tener el conjunto armado, si la
    #: plantilla las promete.
    dimensiones_esperadas: Callable[[Any], tuple[float, float, float]] | None = None
    #: Avisos propios de la plantilla: lista de dicts como los de `validaciones`.
    avisos: Callable[[Any], list[dict[str, str]]] | None = None

    TOLERANCIA: ClassVar[float] = 0.01

    def normalizar(self, parametros: dict[str, Any] | None) -> Parametros:
        """Valida los parámetros y completa los que falten con su valor por defecto."""
        from pydantic import ValidationError

        try:
            p = self.modelo.model_validate(parametros or {})
        except ValidationError as e:
            raise ErrorParametros(_errores_pydantic(e)) from e
        cruzados = p.comprobar()
        if cruzados:
            raise ErrorParametros([{"campo": c, "mensaje": m} for c, m in cruzados])
        return p

    def disenar(self, parametros: dict[str, Any] | None = None) -> "Diseno":
        p = self.normalizar(parametros)
        piezas = self.construir(p)
        ids = [pz.id for pz in piezas]
        if len(set(ids)) != len(ids):
            raise ValueError(f"La plantilla «{self.codigo}» repite ids de pieza: {ids}")
        return Diseno(plantilla=self, parametros=p, piezas=piezas)


@dataclass
class Diseno:
    """Una plantilla con parámetros concretos: la única fuente de la geometría."""

    plantilla: Plantilla
    parametros: Parametros
    piezas: list[Pieza]

    @cached_property
    def instancias(self) -> list[Instancia]:
        """Cada pieza extruida y puesta en cada una de sus ubicaciones."""
        salida: list[Instancia] = []
        for pieza in self.piezas:
            for nombre, ubicacion in zip(pieza.nombres_nodo(), pieza.ubicaciones):
                solido = pieza.solido_local.moved(ubicacion)
                solido.label = nombre
                salida.append(Instancia(nombre=nombre, pieza=pieza, solido=solido))
        return salida

    @cached_property
    def caja(self) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
        """Caja envolvente del conjunto armado: (mínimo, máximo)."""
        cajas = [i.solido.bounding_box() for i in self.instancias]
        mn = tuple(min(getattr(b.min, eje) for b in cajas) for eje in "XYZ")
        mx = tuple(max(getattr(b.max, eje) for b in cajas) for eje in "XYZ")
        return mn, mx  # type: ignore[return-value]

    def dimensiones(self) -> dict[str, float]:
        mn, mx = self.caja
        return {eje: redondear(mx[i] - mn[i]) for i, eje in enumerate("xyz")}

    def despiece(self) -> list[dict[str, Any]]:
        return [
            {
                "id": p.id,
                "nombre": p.nombre,
                "cantidad": p.cantidad,
                "espesor_mm": redondear(p.espesor_mm),
                "ancho_mm": redondear(p.ancho_mm),
                "alto_mm": redondear(p.alto_mm),
                "area_mm2": redondear(p.area_mm2),
                "perimetro_mm": redondear(p.perimetro_mm),
            }
            for p in self.piezas
        ]

    def parametros_normalizados(self) -> dict[str, Any]:
        return self.parametros.model_dump(mode="json")


# --------------------------------------------------------------------------
# Mensajes de validación de pydantic, en español
# --------------------------------------------------------------------------


def _errores_pydantic(error: Any) -> list[dict[str, str]]:
    salida = []
    for e in error.errors():
        campo = ".".join(str(parte) for parte in e.get("loc", ()))
        salida.append({"campo": campo, "mensaje": _mensaje(e)})
    return salida


def _mensaje(e: dict[str, Any]) -> str:
    tipo = e.get("type", "")
    ctx = e.get("ctx") or {}
    if tipo == "greater_than_equal":
        return f"Debe ser mayor o igual que {ctx.get('ge')}."
    if tipo == "greater_than":
        return f"Debe ser mayor que {ctx.get('gt')}."
    if tipo == "less_than_equal":
        return f"Debe ser menor o igual que {ctx.get('le')}."
    if tipo == "less_than":
        return f"Debe ser menor que {ctx.get('lt')}."
    if tipo == "literal_error":
        return f"Debe ser uno de: {ctx.get('expected')}."
    if tipo == "extra_forbidden":
        return "Parámetro desconocido para esta plantilla."
    if tipo == "missing":
        return "Falta este parámetro."
    if tipo.startswith(("float", "int", "finite_number", "decimal")):
        return "Debe ser un número entero." if tipo.startswith("int") else "Debe ser un número."
    if tipo.startswith("bool"):
        return "Debe ser verdadero o falso."
    if tipo.startswith("string"):
        return "Debe ser un texto."
    if tipo == "value_error":
        return str(ctx.get("error") or e.get("msg", "Valor no válido."))
    return str(e.get("msg", "Valor no válido."))
