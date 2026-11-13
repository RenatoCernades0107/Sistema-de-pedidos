# Procedencia

Contenido de terceros, copiado sin modificar para usarlo más adelante como
material de referencia del modo de diseño libre (un LLM que escribe build123d).
El motor no lo importa ni lo ejecuta.

- **Origen:** <https://github.com/rawwerks/VibeCAD>, rama `main`.
- **Commit:** `609e8885270cfdaeb73d96dda2e29362194d544d` (2025-12-17).
- **Descargado:** 2026-11-13.
- **Licencia:** MIT. El texto completo está en [`LICENSE`](LICENSE), copiado del
  repositorio de origen; hay que conservarlo junto a estos archivos.

## Qué se copió

Se respeta la estructura de carpetas del repositorio de origen:

- `LICENSE`
- `plugins/build123d/skills/build123d/` — `SKILL.md`, `references/` (guías y
  ejemplos) y `scripts/harness.py`
- `plugins/build123d/skills/model-compare/` — `SKILL.md` y `scripts/model_diff.py`
- `plugins/render-glb/skills/render-glb/SKILL.md`
- `plugins/gltf-transform/skills/gltf-transform/SKILL.md`

No se copiaron los `plugin.json` ni el resto del repositorio.

## Para actualizar

Clonar el repositorio de origen, copiar de nuevo esas carpetas tal cual y
anotar aquí el commit y la fecha. No editar los archivos copiados: los cambios
propios van fuera de `skills/vibecad/`.
