# syntax=docker/dockerfile:1.7
# RunWay Route service image (1 worker, target 1 vCPU / 1.5 GiB, separate from the HR container).
#
# The data bundle is NOT in git. Pass it as a named build context (folder with DATA_MANIFEST.md, data/, reports/):
#   docker build -t runway-route --build-context route_data=<path>/route_data_bundle_v2 ai/route_service
# The build checks every bundle file against DATA_MANIFEST.md, builds the network store + source snapshot,
# then starts the engine once (load + warm-up request) so the Numba cache is in the image.
# Run (read-only root fs; the Gate review log needs a writable /tmp):
#   docker run --cpus 1 --memory 1.5g --read-only --tmpfs /tmp -p 8000:8000 runway-route
FROM python:3.12.10-slim

# osmium이 사용하는 XML 파서 런타임 라이브러리를 설치한다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libexpat1 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMBA_NUM_THREADS=1 \
    NUMBA_CACHE_DIR=/opt/route/numba_cache \
    RUNWAY_DATA_DIR=/data \
    RUNWAY_GRAPH_CACHE_SIZE=2 \
    RUNWAY_USABILITY_LOG_DIR=/tmp/runway_usability_gate_log \
    ROUTE_DEBUG=0 \
    ROUTE_WARMUP=1

WORKDIR /app
COPY requirements.txt constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt

# data bundle (named build context "route_data"), verified before anything is derived from it
COPY --from=route_data . /data/
COPY tools/data/verify_bundle.py tools/data/verify_bundle.py
RUN python -B tools/data/verify_bundle.py /data

COPY runway_routing ./runway_routing
COPY analysis ./analysis
COPY app ./app

# derived data: compact network store + source snapshot (keys = extract + parser/store code + library versions)
RUN python -B -m runway_routing.network_store build \
 && python -B -m runway_routing.source_snapshot build
# start the engine once: load + warm-up request, writes the Numba cache; fails the build if the engine is not ready
RUN python -B -c "from app.config import load_settings; from app.main import Engine, _default_pipeline_factory; \
e = Engine(load_settings(), _default_pipeline_factory); e.start(); \
assert e.phase == 'ready', e.error; print('engine ready', e.load_s, e.warmup_s)"

RUN useradd --system --uid 10001 runway \
 && chmod -R a-w /data /opt/route/numba_cache /app
USER runway

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/internal/v1/ready', timeout=4).status == 200 else 1)"
CMD ["python", "-B", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
