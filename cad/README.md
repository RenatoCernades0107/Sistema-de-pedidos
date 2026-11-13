# Motor CAD

Servicio Python sin estado (FastAPI + build123d) que convierte una **plantilla**
y sus **parámetros** en geometría: el modelo 3D armado (GLB), el despiece
plano, el DXF de corte y el STEP. El contrato de la API está en
[`docs/API_cad.md`](../docs/API_cad.md). Todas las medidas van en milímetros.

Cada plantilla devuelve una lista de piezas planas (contorno + espesor +
ubicaciones). El 3D se obtiene extruyendo esos mismos contornos, así que lo que
se ve en el render es exactamente lo que sale del corte.

## Correr en local

Hace falta [uv](https://docs.astral.sh/uv/). Desde esta carpeta (`cad/`):

```bash
uv sync                                        # crea .venv con Python 3.13
uv run uvicorn motor.api:app --port 8001       # añadir --reload al desarrollar
curl localhost:8001/salud
curl -X POST localhost:8001/generar -H 'content-type: application/json' \
     -d '{"plantilla":"caja","parametros":{"tipo_union":"encastre"}}'
```

## Pruebas

```bash
uv run pytest            # todo (medio minuto)
uv run pytest tests/test_api.py -q
```

## Variables de entorno

| Variable | Para qué | Por defecto |
| --- | --- | --- |
| `CAD_API_KEY` | Clave que se exige en la cabecera `X-API-Key`. Sin definir, no se exige (solo local). | sin definir |
| `CAD_PLANCHA_MAX_MM` | Plancha más grande, `ANCHOxALTO`. Una pieza mayor da el error `excede_plancha`; también es el ancho máximo de una fila del DXF. | `2440x1220` |

## Estructura

```
motor/
  api.py               rutas, autenticación y errores del contrato
  exportar.py          GLB, STEP y DXF
  validacion.py        interferencias, plancha máxima, medidas, piezas angostas
  plantillas/
    base.py            Pieza, Plantilla, Diseno y ayudas para dibujar contornos
    registro.py        registro de plantillas y esquema JSON plano
    dentado.py         contornos con dedos de encastre
    formas.py          esquinas redondeadas, agujeros, ranuras (ARC/CIRCLE reales) y texto
    caja.py  alzador.py  porta_afiche.py  anfora.py  display.py
    atril.py  tareco.py  letrero.py  letras.py
tests/
skills/vibecad/        material de terceros para el futuro diseño libre (ver PROCEDENCIA.md)
```

## Agregar una plantilla

1. Crear `motor/plantillas/<codigo>.py` con:
   - un modelo de parámetros que herede de `Parametros`. Solo campos planos
     (`float`, `int`, `bool`, `Literal[...]` de textos o `str` con
     `max_length` para un texto libre), cada uno con `title`,
     `description`, valor por defecto y `ge`/`le`. Las reglas que cruzan campos
     van en `comprobar()` y devuelven pares `(campo, mensaje)`;
   - una función `construir(p) -> list[Pieza]`. Cada `Pieza` lleva su contorno
     plano en XY (`cara_rectangulo`, `cara_poligono`, `con_agujeros`,
     `contorno_dentado` o cualquier `Face` de build123d), su espesor y sus
     ubicaciones (`ubicar(origen, dir_u, dir_normal)`): una por cada copia;
   - `registrar(Plantilla(...))`, con `dimensiones_esperadas` si la plantilla
     promete medidas exteriores. La familia debe ser una de `FAMILIAS`.
2. Importarla en `motor/plantillas/__init__.py`.
3. Documentar en el módulo la convención de armado (qué pieza va sobre cuál) y
   agregar pruebas: medidas exteriores, sin interferencias, cantidad de piezas.

Al cambiar la geometría de una plantilla ya publicada, subir su `version`.

## Fuente para texto

`letras` y `letrero` dibujan texto con DejaVu Sans Bold
(`/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`, paquete Debian
`fonts-dejavu-core`, ya instalado en el `Dockerfile`). Otra fuente: variable
`CAD_FUENTE` con la ruta a un `.ttf`/`.otf`.

Piezas que en la realidad se doblan en caliente (atril, tareco) se arman con
su equivalente de piezas planas pegadas y la plantilla avisa con `sin_plegado`.

## DXF

R12 (AC1009) ASCII escrito con ezdxf, en mm (`$INSUNITS = 4`), solo `LINE`,
`ARC` y `CIRCLE`; capa `CORTE` (color 1) y `GRABADO` (color 3), con el color
también en cada entidad. Es lo que RDWorks importa mejor y lo mismo que usa
`lib/cortes/dxf.ts`. Con `kerf_mm > 0` el contorno exterior se corre medio kerf
hacia afuera y los agujeros medio kerf hacia adentro.

## Despliegue

`Dockerfile` arma una imagen que corre uvicorn en el puerto 8080 y trae el AWS
Lambda Web Adapter, así que sirve tal cual para Lambda (imagen de contenedor)
y como contenedor normal:

```bash
docker build -t motor-cad .
docker run -p 8000:8080 -e CAD_API_KEY=secreta motor-cad
```

## Despliegue en AWS (Serverless Framework)

`serverless.yml` crea dos funciones Lambda de imagen de contenedor, cada una con
su Function URL (`authType: NONE`; la propia app exige `X-API-Key`):

| Función | Imagen | Memoria / timeout | Notas |
| --- | --- | --- | --- |
| `motor` | `Dockerfile` (`motor.api`) | 2048 MB / 60 s | rol por defecto (solo logs) |
| `sandbox` | `sandbox/Dockerfile` (`sandbox.api`) | 2048 MB / 30 s | concurrencia reservada (5), rol propio solo con logs + ENI de VPC, en VPC sin NAT |

**Requisitos:** Serverless Framework (v3 o v4) con credenciales de AWS, Docker
(construye y sube las imágenes a ECR), y en la región:

1. Parámetros SSM `SecureString`:
   ```bash
   aws ssm put-parameter --type SecureString --name /plexiacril/prod/CAD_API_KEY --value "$(openssl rand -hex 32)"
   aws ssm put-parameter --type SecureString --name /plexiacril/prod/CAD_SANDBOX_API_KEY --value "$(openssl rand -hex 32)"
   ```
2. Para el sandbox: dos subredes **privadas sin ruta a NAT ni a Internet
   Gateway** y un security group **sin reglas de salida**. Así el código que
   ejecuta el sandbox no tiene salida a internet.

**Desplegar:**

```bash
cd cad
serverless deploy --stage prod --region us-east-1 \
  --param="sandboxSubnetIdA=subnet-..." --param="sandboxSubnetIdB=subnet-..." \
  --param="sandboxSecurityGroupId=sg-..."
serverless info --stage prod   # muestra MotorUrl y SandboxUrl
curl https://<MotorUrl>/salud
```

**Variables del host de Next.js** (Vercel u otro):

| Variable | Valor |
| --- | --- |
| `CAD_API_BASE_URL` | `MotorUrl` sin la `/` final |
| `CAD_API_KEY` | el valor de `/plexiacril/<stage>/CAD_API_KEY` |
| `CAD_SANDBOX_BASE_URL` | `SandboxUrl` sin la `/` final |
| `CAD_SANDBOX_API_KEY` | el valor de `/plexiacril/<stage>/CAD_SANDBOX_API_KEY` |
| `CAD_DISENO_LIBRE` | `1` para activar el diseño libre (sin definir, apagado) |

**Compromisos:**

- Function URL pública + clave en cabecera: simple y sin API Gateway, pero no
  hay límite de tasa ni WAF; la concurrencia reservada del sandbox acota el
  gasto. Para más control, poner CloudFront/API Gateway delante.
- Las claves se leen de SSM **al desplegar** y quedan como variables de
  entorno (cifradas en reposo, visibles para quien lea la configuración de la
  función). Rotar = actualizar SSM y volver a desplegar.
- Sandbox en VPC sin NAT: sin salida a internet ni a servicios de AWS (no hay
  endpoints de VPC). Los logs siguen funcionando porque los envía el servicio
  Lambda, no la función. Cuesta algo de arranque en frío extra por la ENI.
- Imágenes de ~1 GB: el primer arranque en frío tarda varios segundos.
