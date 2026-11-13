"""
Sandbox de diseño libre: ejecuta código build123d escrito por el LLM.

Ver `cad/sandbox/README.md` para el modelo de seguridad. Resumen: el filtro de
AST y las restricciones del proceso hijo son defensa en profundidad; la
frontera real de aislamiento es el despliegue (contenedor/Lambda aparte, sin
red y sin credenciales).
"""

VERSION = "0.1.0"
