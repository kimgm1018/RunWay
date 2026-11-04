# 저장소 루트를 빌드 컨텍스트로 사용한다. GRU·ODE 파일은 실행 시 연결한다.
FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HR_DEVICE=cpu

WORKDIR /app/ai/service
COPY ai/service/requirements.txt ./requirements.txt

# 서비스에서 지정한 버전을 유지하되 CUDA 대신 CPU 전용 PyTorch를 설치한다.
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && pip check

COPY ai/service/app/ ./app/
COPY ai/workspace/doyeon/gru/src/data.py \
     ai/workspace/doyeon/gru/src/model.py \
     ai/workspace/doyeon/gru/src/predictor.py /app/ai/workspace/doyeon/gru/src/

# 모델은 이미지에 포함하지 않고 실행 시 읽기 전용 파일로 연결한다.
RUN mkdir -p models && chown -R 10001:10001 /app
USER 10001:10001

EXPOSE 8000
# 서버 응답뿐 아니라 모델 로드 완료까지 확인한다. 모델 미연결 시 unhealthy다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD python -c "import json,os,sys,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3); d=json.load(r); ode_ok=not os.getenv('ODEV21_CHECKPOINT_PATH') or d.get('models',{}).get('ode',{}).get('status') == 'UP'; sys.exit(0 if r.status == 200 and d.get('status') == 'UP' and d.get('modelLoaded') is True and ode_ok else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# MR에서는 모델 파일 없이 API 기본 테스트를 실행한다. 실제 모델 검증과 구분한다.
FROM base AS test
USER root
COPY ai/service/requirements-dev.txt ./requirements-dev.txt
RUN pip install --no-cache-dir -r requirements-dev.txt && pip check \
    && mkdir /reports && chown 10001:10001 /reports
COPY ai/service/tests/ ./tests/
COPY ai/service/tools/ ./tools/
COPY ai/service/scripts/ ./scripts/
COPY infra/ai/check.sh infra/ai/deploy.sh infra/ai/compose.yaml /app/infra/ai/
COPY infra/ai/public-settings.sh infra/ai/preflight.py infra/ai/prepare_models.py infra/ai/models.json /app/infra/ai/
COPY infra/ai/grant-readonly.sh /app/infra/ai/
COPY infra/ai/tests/ /app/infra/ai/tests/
# 배포 테스트의 모의 Shell 파일은 실행 제한이 있는 /tmp 대신 이 경로에 둔다.
ENV TMPDIR=/reports
USER 10001:10001
CMD ["python", "-m", "pytest", "-q", "tests", "/app/infra/ai/tests", "-p", "no:cacheprovider", "--junitxml=/reports/pytest.xml"]

# target을 생략한 일반 빌드는 테스트 도구가 없는 실행 이미지를 만든다.
FROM base AS runtime
