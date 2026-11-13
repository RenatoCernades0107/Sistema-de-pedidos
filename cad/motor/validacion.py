"""
Comprobaciones sobre un diseño. Devuelven las `validaciones` del contrato:
`{ nivel: "error" | "aviso", codigo, mensaje, pieza? }`.

  solido_invalido           error  el sólido de una pieza no es válido
  interferencia             error  dos piezas armadas ocupan el mismo volumen
  excede_plancha            error  la pieza no entra en la plancha más grande
  dimensiones_no_coinciden  error  el conjunto armado no mide lo que se pidió
  pared_delgada             aviso  pieza más angosta que dos veces su espesor
  (más los avisos propios de cada plantilla)
"""

from __future__ import annotations

import os
from itertools import combinations
from typing import Any

from .plantillas.base import Diseno, Instancia

#: Plancha más grande que se trabaja, en mm. Se cambia con CAD_PLANCHA_MAX_MM="2440x1220".
PLANCHA_MAX_MM = (2440.0, 1220.0)
#: Volumen compartido (mm³) por debajo del cual dos piezas solo se tocan.
TOLERANCIA_VOLUMEN = 1e-3
#: Diferencia admitida (mm) entre las medidas pedidas y las del conjunto armado.
TOLERANCIA_MEDIDA = 0.01


def plancha_maxima() -> tuple[float, float]:
    texto = os.environ.get("CAD_PLANCHA_MAX_MM", "").lower().replace(" ", "")
    if texto:
        try:
            a, b = (float(v) for v in texto.split("x"))
            if a > 0 and b > 0:
                return (max(a, b), min(a, b))
        except ValueError:
            pass
    return PLANCHA_MAX_MM


def volumen_comun(a: Instancia, b: Instancia) -> float:
    """Volumen que comparten dos piezas armadas (0 si solo se tocan)."""
    ca, cb = a.solido.bounding_box(), b.solido.bounding_box()
    for eje in "XYZ":
        if getattr(ca.max, eje) <= getattr(cb.min, eje) + 1e-6 or getattr(cb.max, eje) <= getattr(ca.min, eje) + 1e-6:
            return 0.0
    comun = a.solido.intersect(b.solido)
    if comun is None:
        return 0.0
    formas = comun if isinstance(comun, (list, tuple)) else [comun]
    return float(sum(getattr(f, "volume", 0.0) or 0.0 for f in formas))


def interferencias(diseno: Diseno) -> list[tuple[str, str, float]]:
    """Pares de instancias que se pisan: (nombre, nombre, volumen)."""
    salida = []
    for a, b in combinations(diseno.instancias, 2):
        v = volumen_comun(a, b)
        if v > TOLERANCIA_VOLUMEN:
            salida.append((a.nombre, b.nombre, v))
    return salida


def validar(diseno: Diseno, plancha: tuple[float, float] | None = None) -> list[dict[str, Any]]:
    salida: list[dict[str, Any]] = []
    plancha = plancha or plancha_maxima()
    lado_mayor, lado_menor = max(plancha), min(plancha)

    for inst in diseno.instancias:
        if not inst.solido.is_valid or inst.solido.volume <= 0:
            salida.append(
                {
                    "nivel": "error",
                    "codigo": "solido_invalido",
                    "mensaje": f"La geometría de «{inst.pieza.nombre}» no es un sólido válido.",
                    "pieza": inst.pieza.id,
                }
            )

    for nombre_a, nombre_b, volumen in interferencias(diseno):
        salida.append(
            {
                "nivel": "error",
                "codigo": "interferencia",
                "mensaje": f"Las piezas «{nombre_a}» y «{nombre_b}» se pisan ({volumen:.2f} mm³ en común).",
                "pieza": nombre_a,
            }
        )

    for pieza in diseno.piezas:
        mayor, menor = max(pieza.ancho_mm, pieza.alto_mm), min(pieza.ancho_mm, pieza.alto_mm)
        if mayor > lado_mayor + TOLERANCIA_MEDIDA or menor > lado_menor + TOLERANCIA_MEDIDA:
            salida.append(
                {
                    "nivel": "error",
                    "codigo": "excede_plancha",
                    "mensaje": (
                        f"«{pieza.nombre}» mide {pieza.ancho_mm:.1f} × {pieza.alto_mm:.1f} mm y no entra en la "
                        f"plancha de {lado_mayor:g} × {lado_menor:g} mm."
                    ),
                    "pieza": pieza.id,
                }
            )
        if menor < 2 * pieza.espesor_mm - 1e-9:
            salida.append(
                {
                    "nivel": "aviso",
                    "codigo": "pared_delgada",
                    "mensaje": (
                        f"«{pieza.nombre}» tiene {menor:.1f} mm de ancho, menos de dos veces su espesor "
                        f"({pieza.espesor_mm:g} mm): es frágil y difícil de pegar."
                    ),
                    "pieza": pieza.id,
                }
            )

    esperadas = diseno.plantilla.dimensiones_esperadas
    if esperadas is not None:
        pedido = esperadas(diseno.parametros)
        real = diseno.dimensiones()
        difs = [abs(real[eje] - pedido[i]) for i, eje in enumerate("xyz")]
        if max(difs) > TOLERANCIA_MEDIDA:
            salida.append(
                {
                    "nivel": "error",
                    "codigo": "dimensiones_no_coinciden",
                    "mensaje": (
                        f"El conjunto armado mide {real['x']:g} × {real['y']:g} × {real['z']:g} mm y se pidió "
                        f"{pedido[0]:g} × {pedido[1]:g} × {pedido[2]:g} mm."
                    ),
                }
            )

    if diseno.plantilla.avisos is not None:
        salida.extend(diseno.plantilla.avisos(diseno.parametros))

    return salida
