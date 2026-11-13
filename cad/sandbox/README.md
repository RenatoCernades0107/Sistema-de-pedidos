# Sandbox de diseño libre

Servicio aparte del motor CAD. Cuando ninguna plantilla sirve, el LLM escribe
código build123d; este servicio lo ejecuta en un proceso hijo con límites y
devuelve lo mismo que `/generar` del motor (GLB, despiece, dimensiones,
validaciones), más el DXF, el STEP y un render PNG para que el LLM vea lo que
construyó. Contrato HTTP: `docs/API_cad.md`, sección «Diseño libre».

## Ejecutar en local

```bash
cd cad
uv run uvicorn sandbox.api:app --port 8002
# pruebas
uv run pytest tests/test_sandbox_*.py
```

En Next.js: `CAD_SANDBOX_BASE_URL=http://localhost:8002`, `CAD_DISENO_LIBRE=1`
(y `CAD_SANDBOX_API_KEY` si el servicio la exige).

Los logs funcionan igual que en el motor (ver «Logs» en `cad/README.md`): un 422 de
`/ejecutar` dice si fue el cuerpo (`parametros_invalidos`) o el código (`codigo_invalido`,
con tipo, línea y traza).

## Contrato del código

```python
from diseno import pieza, rectangulo, poligono, circulo, ranura, agujero_circular, con_agujeros, ubicar, linea
from build123d import *   # versión filtrada: sin E/S de archivos ni OCP crudo
import math

base = con_agujeros(rectangulo(80, 100), [ranura(15, 30, 50, 3)])
piezas = [pieza("base", "Base", base, 3, [ubicar((0, 0, 0), (1, 0, 0), (0, 0, 1))])]
nombre = "Soporte"   # opcional
```

`piezas` es obligatorio: una lista de piezas planas del marco de plantillas
(`cad/motor/plantillas/base.py`). El resultado pasa por las mismas
validaciones y exportaciones que una plantilla. `print` funciona y su salida
(recortada) vuelve en `salida`.

## Modelo de seguridad

**La frontera de aislamiento real es el despliegue**, no el código de esta
carpeta. Python no se puede encerrar de forma fiable desde dentro de Python;
todo lo que sigue es defensa en profundidad para que un error del LLM (o un
prompt injection) falle pronto y de forma legible.

Medidas en el proceso (todas cubiertas por `tests/test_sandbox_*.py` salvo
donde se indica):

1. **Filtro AST** (`verificador.py`): imports solo de `build123d`, `math` y
   `diseno`; prohíbe nombres como `open`, `exec`, `eval`, `compile`,
   `getattr`, `type`, `__import__`, `os`, `sys`...; cualquier nombre o atributo
   con guion bajo; atributos de módulos/marcos (`.os`, `.gi_frame`,
   `.format`...); cadenas con `__`; clases, `try`, `with`, `global`; y todo lo
   que parezca E/S de archivos de build123d/OCP (`import_*`, `export_*`,
   `Mesher`, `font_path`, `.wrapped`). Probado clase por clase.
2. **Proceso hijo** (`ejecutor.py` → `trabajador.py`): `python -I`, entorno
   vacío (`env={}`, sin credenciales heredadas; *no tiene prueba propia, se
   comprueba leyendo el código*), directorio temporal propio que se borra al
   terminar, grupo de procesos propio.
3. **Límites** (`setrlimit` antes de exec): CPU (`RLIMIT_CPU`), memoria
   (`RLIMIT_AS`, 3 GB por defecto: importar OCP ya reserva ~1,2 GB virtuales),
   tamaño de archivo (`RLIMIT_FSIZE`), sin core dumps, 256 descriptores; reloj
   con `SIGKILL` al grupo. Probados: bucle infinito (reloj y CPU) y bomba de
   memoria (lista y cadena gigantes).
4. **Builtins reducidos** y `__import__` con lista blanca; `build123d` y
   `diseno` se exponen como módulos **filtrados** (solo objetos definidos en
   build123d, sin módulos, sin clases OCP, sin import/export).
5. **Gancho de auditoría** (`sys.addaudithook`, permanente): bloquea
   subprocesos, `os.system`/`fork`/`exec`/`spawn`, sockets, ctypes, borrar o
   renombrar archivos; `open` solo lee dentro de la instalación de Python y de
   `cad/`, y solo escribe en el temporal. Probado (red, subproceso, fork,
   lectura de `/etc/passwd`, escritura fuera, ctypes).

Limitaciones conocidas (por eso manda el despliegue):

- OpenCascade lee y escribe archivos **desde C++**, sin pasar por el gancho
  de auditoría. Se mitiga quitando esas funciones del módulo expuesto y del
  AST, pero cualquier camino que se escape llega al sistema de archivos con
  los permisos del proceso.
- `RLIMIT_NPROC` no se usa: cuenta hilos por usuario y OCP/numpy los usan.
  Los subprocesos los cortan el AST y el gancho de auditoría.
- Un monopolio de CPU dentro del límite (p. ej. geometría enorme) consume el
  tiempo de la invocación; el reloj lo corta.
- Cada ejecución arranca un Python nuevo e importa build123d (~2–3 s en
  caliente, más en frío).

## Despliegue en AWS

- **Lambda propia** con la imagen de `sandbox/Dockerfile` (construida desde
  `cad/`), separada del Lambda del motor.
- **Sin red de salida**: sin VPC, o en una VPC con subredes privadas **sin**
  NAT gateway ni endpoints; si se usa Function URL, que la llame solo el
  servidor de Next.js (clave `CAD_SANDBOX_API_KEY` en la cabecera
  `X-API-Key`, guardada como secreto en el servidor de Next.js).
- **Rol IAM mínimo**: solo `AWSLambdaBasicExecutionRole` (logs). Nada de S3,
  Secrets Manager ni Supabase: el sandbox no necesita credenciales y no debe
  tener ninguna en sus variables de entorno salvo su propia clave de entrada.
- **Memoria** 3008 MB o más (OCP + hijo); `CAD_SANDBOX_MEMORIA_MB` debe quedar
  por debajo de la memoria del Lambda. **Timeout** del Lambda ≥ 90 s con
  `CAD_SANDBOX_TIEMPO_S=60`. **Concurrencia reservada** baja (p. ej. 5) para
  acotar el coste de abusos. Sistema de archivos de solo lectura salvo `/tmp`
  (lo da Lambda).
- Fuera de Lambda: `docker run --read-only --tmpfs /tmp --pids-limit 256
  --memory 4g --cap-drop ALL --security-opt no-new-privileges` en una red
  interna de Docker (`docker network create --internal`) compartida solo con
  quien lo llama, para que no tenga salida a internet.
