# syntax=docker/dockerfile:1.7
# RunWay Route service image (1 worker, target 1 vCPU / 1.5 GiB, separate from the HR container).
#
# The data bundle is NOT in git. Pass it as a named build context (folder with DATA_MANIFEST.md, data/, reports/):
#   docker build -t runway-route --build-context route_data=<path>/route_data_bundle_v2 ai/route_service
# The build checks the bundle against DATA_MANIFEST.md (every listed file, and no unlisted file), builds the network
# store + source snapshot, then starts the engine once AS THE RUNTIME USER (uid 10001, code and data read-only:
# load + warm-up request) so the compiled Numba cache is in the image (/opt/route/numba_cache, a read-only seed).
# Run (read-only root fs; /tmp must be writable: Gate review log + the Numba cache):
#   docker run --cpus 1 --memory 1.5g --read-only --tmpfs /tmp -p 8000:8000 runway-route
#
# Numba cache (S15P31E105-441 R2): Numba 0.68 uses a cache directory only if it can write a temporary file there. With
# no writable candidate (NUMBA_CACHE_DIR, the source __pycache__, the user cache dir) importing the cached kernels
# raises "cannot cache function ...: no locator available" and the app does not start. So the start command copies the
# read-only seed to NUMBA_CACHE_DIR=/tmp/numba_cache (a few MB) and Numba reads / writes there. Same kernels, same
# results. On a CPU unlike the build machine Numba recompiles into /tmp (slower first start only).
FROM python:3.12.10-slim AS dependencies

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
    NUMBA_CACHE_DIR=/tmp/numba_cache \
    RUNWAY_DATA_DIR=/data \
    RUNWAY_GRAPH_CACHE_SIZE=2 \
    RUNWAY_USABILITY_LOG_DIR=/tmp/runway_usability_gate_log \
    ROUTE_DEBUG=0 \
    ROUTE_WARMUP=1

WORKDIR /app
COPY requirements.txt constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt

# MR은 실제 데이터·HF 토큰 없이 운영과 같은 Python·런타임 의존성으로 검사한다.
FROM dependencies AS test
RUN pip install --no-cache-dir pytest==9.2.0 httpx==0.28.1 \
 && pip check \
 && useradd --system --uid 10001 --no-create-home runway \
 && mkdir /reports && chown runway:runway /reports
COPY runway_routing ./runway_routing
COPY analysis ./analysis
COPY app ./app
COPY tests ./tests
COPY tools/route_regression ./tools/route_regression
# 전국 미리 계산 빌더(S15P31E105-586)를 합성 저장소 시험이 직접 부른다. 운영 이미지에는 넣지 않는다.
COPY tools/data ./tools/data
USER runway
# 실제 엔진 테스트는 데이터 부재로 생략되며 그 결과도 JUnit에 남는다.
CMD ["python", "-B", "-m", "pytest", "-q", "tests", "tools/route_regression/test_identity_checks.py", "-p", "no:cacheprovider", "--junitxml=/reports/pytest.xml"]

# 일반 빌드는 기존처럼 데이터 검증·엔진 예열을 포함한 운영 이미지를 만든다.
FROM dependencies AS runtime
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

# from here on code and data are read-only; only the Numba seed directory belongs to the runtime user
RUN useradd --system --uid 10001 --no-create-home runway \
 && mkdir -p /opt/route/numba_cache && chown runway:runway /opt/route/numba_cache \
 && chmod -R a-w /data /app
# start the engine once as the runtime user: load + warm-up request, writes the Numba cache seed;
# fails the build if the engine is not ready
USER runway
RUN NUMBA_CACHE_DIR=/opt/route/numba_cache python -B -c "from app.config import load_settings; \
from app.main import Engine, _default_pipeline_factory; \
e = Engine(load_settings(), _default_pipeline_factory); e.start(); \
assert e.phase == 'ready', e.error; print('engine ready', e.load_s, e.warmup_s)"
USER root
RUN chmod -R a-w /opt/route/numba_cache
USER runway

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/internal/v1/ready', timeout=4).status == 200 else 1)"
# Copy the read-only Numba seed into the writable cache dir (u+w: cp keeps the seed's read-only modes), then start
# (exec: uvicorn is PID 1 and gets the signals). NUMBA_CACHE_DIR is set here on purpose, not taken from the environment:
# a deployment that passes NUMBA_CACHE_DIR=/opt/route/numba_cache (the read-only seed) would otherwise copy the seed
# onto itself and fail to start. /tmp must be writable (tmpfs); the seed is about 0.3 MB.
CMD ["sh", "-c", "export NUMBA_CACHE_DIR=/tmp/numba_cache && mkdir -p \"$NUMBA_CACHE_DIR\" && cp -R /opt/route/numba_cache/. \"$NUMBA_CACHE_DIR\"/ && chmod -R u+w \"$NUMBA_CACHE_DIR\" && exec python -B -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
