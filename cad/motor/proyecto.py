"""
Varios diseños como uno solo, para cortarlos juntos.

Un proyecto agrupa los diseños de un mismo trabajo (los letreros de una lámina).
Para acomodar sus piezas en las mismas planchas el DXF necesita verlas como un
solo `Diseno`: aquí se unen, cada pieza con el id prefijado por la referencia de
su diseño (`d2__lateral`) para que dos piezas llamadas igual no choquen. La app
(`lib/cad/proyecto-corte.ts`) usa el MISMO prefijo al acomodar, así que las
planchas que manda valen tal cual con `validar_planchas` y
`exportar_dxf_planchas`, que no cambian.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .plantillas.base import Diseno, Pieza

#: Lo que separa la referencia del diseño del id de la pieza (`d2__lateral`).
SEPARADOR_REF = "__"
#: Tope del id de una pieza (el mismo de `EntradaPiezaPlancha`).
MAX_ID_PIEZA = 64


def id_de_proyecto(ref: str, id_pieza: str) -> str:
    """`d2__lateral`. Lanza `ValueError` si no cabe en el tope de un id."""
    completo = f"{ref}{SEPARADOR_REF}{id_pieza}"
    if len(completo) > MAX_ID_PIEZA:
        raise ValueError(f"El id «{id_pieza}» es demasiado largo para un proyecto (máximo {MAX_ID_PIEZA - len(ref) - len(SEPARADOR_REF)} caracteres).")
    return completo


def unir_disenos(disenos: list[tuple[str, Diseno]]) -> Diseno:
    """
    Un `Diseno` con las piezas de todos, cada una con el id (y los nodos)
    prefijados por la referencia de su diseño. La plantilla y los parámetros son
    los del primero: el DXF solo los usa para el nombre del conjunto.
    """
    if not disenos:
        raise ValueError("No hay diseños que unir.")
    refs = [ref for ref, _ in disenos]
    if len(set(refs)) != len(refs):
        raise ValueError("Dos diseños tienen la misma referencia.")
    piezas: list[Pieza] = []
    for ref, diseno in disenos:
        for p in diseno.piezas:
            piezas.append(
                replace(
                    p,
                    id=id_de_proyecto(ref, p.id),
                    nodos=[id_de_proyecto(ref, n) for n in p.nombres_nodo()],
                    origen=id_de_proyecto(ref, p.origen) if p.origen else None,
                )
            )
    primero = disenos[0][1]
    return Diseno(plantilla=primero.plantilla, parametros=primero.parametros, piezas=piezas)


def seleccionar_copias(diseno: Diseno, solo: dict[str, list[int]]) -> Diseno:
    """
    El mismo diseño con solo las copias pedidas: `solo` es `{id de pieza: [copias]}`
    con las copias de 1 a la cantidad de la pieza. Las piezas que no se nombran se
    van. Sirve para el DXF suelto de lo que se corta aparte (MDF…).
    """
    por_id = {p.id: p for p in diseno.piezas}
    faltan = sorted(set(solo) - set(por_id))
    if faltan:
        raise ValueError(f"No hay piezas llamadas {', '.join(faltan)}.")
    piezas: list[Pieza] = []
    for id_pieza, copias in solo.items():
        p = por_id[id_pieza]
        indices = sorted(set(copias))
        fuera = [c for c in indices if c < 1 or c > p.cantidad]
        if fuera:
            raise ValueError(f"La pieza «{id_pieza}» tiene {p.cantidad} copias; no existe la {fuera[0]}.")
        if not indices:
            continue
        nodos = p.nombres_nodo()
        piezas.append(
            replace(p, ubicaciones=[p.ubicaciones[i - 1] for i in indices], nodos=[nodos[i - 1] for i in indices])
        )
    if not piezas:
        raise ValueError("No quedó ninguna copia que exportar.")
    return Diseno(plantilla=diseno.plantilla, parametros=diseno.parametros, piezas=piezas, espesores=diseno.espesores)


def disenar_plantilla(codigo: str, parametros: dict[str, Any] | None) -> Diseno:
    """El diseño de una plantilla del registro con sus parámetros. Lanza `ValueError` si no existe o no valida."""
    from .plantillas import obtener

    plantilla = obtener(codigo)
    if plantilla is None:
        raise ValueError(f"No existe la plantilla «{codigo}».")
    return plantilla.disenar(parametros or {})
