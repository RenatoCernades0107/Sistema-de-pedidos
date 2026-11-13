# Motor CAD de Plexiacril.
#
# La misma imagen sirve para:
#   - AWS Lambda (imagen de contenedor): el Lambda Web Adapter, que va como
#     extensión, traduce los eventos de Lambda a HTTP contra uvicorn en el 8080.
#   - Un contenedor cualquiera:  docker run -p 8000:8080 -e CAD_API_KEY=... motor-cad
#
# Construir desde la carpeta cad/:  docker build -t motor-cad .

FROM python:3.13-slim-bookworm

# Lambda Web Adapter. Fuera de Lambda la extensión no se ejecuta.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv

# Bibliotecas del sistema que necesita OCP (el núcleo de build123d) y la fuente
# DejaVu Sans Bold de las plantillas «letras» y «letrero» (motor/plantillas/formas.py).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libx11-6 libxext6 libxrender1 libfontconfig1 libexpat1 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

# Primero las dependencias: esta capa solo cambia si cambian pyproject.toml o uv.lock.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY motor ./motor
COPY skills ./skills

# En Lambda solo se puede escribir en /tmp y el proceso no corre como root.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    MPLCONFIGDIR=/tmp/.cache/matplotlib \
    PORT=8080 \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/salud

# Importar el motor al construir: falla aquí, y no en producción, si falta una biblioteca.
RUN python -c "import motor.api; from motor.plantillas import listar; print([p.codigo for p in listar()])" \
    && chmod -R a+rX /app

EXPOSE 8080
CMD ["uvicorn", "motor.api:app", "--host", "0.0.0.0", "--port", "8080"]
