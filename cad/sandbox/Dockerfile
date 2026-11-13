# Sandbox de diseño libre de Plexiacril (servicio aparte del motor).
#
# Se despliega como su PROPIA función Lambda (imagen de contenedor), sin VPC con
# salida a internet y con un rol IAM sin permisos. Ver cad/sandbox/README.md.
#
# Construir desde la carpeta cad/ (necesita motor/ y skills/ además de sandbox/):
#   docker build -f sandbox/Dockerfile -t sandbox-cad .
#   docker run -p 8002:8080 -e CAD_SANDBOX_API_KEY=... sandbox-cad

FROM python:3.13-slim-bookworm

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libx11-6 libxext6 libxrender1 libfontconfig1 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

# El motor se reutiliza por import (solo lectura); el sandbox no expone sus rutas.
COPY motor ./motor
COPY sandbox ./sandbox
COPY skills ./skills

# Usuario sin privilegios fuera de Lambda (en Lambda el proceso ya no es root).
RUN useradd --system --no-create-home --uid 10001 sandbox \
    && chmod -R a+rX,go-w /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    TMPDIR=/tmp \
    PORT=8080 \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/salud

RUN python -c "import sandbox.api, sandbox.trabajador, build123d, PIL"

USER 10001
EXPOSE 8080
CMD ["uvicorn", "sandbox.api:app", "--host", "0.0.0.0", "--port", "8080"]
