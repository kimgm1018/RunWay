# 저장소 루트를 빌드 컨텍스트로 사용한다. GRU는 현재 검증용 후보 모델이다.
FROM python:3.12-slim-bookworm

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
    CMD python -c "import json,sys,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3); d=json.load(r); sys.exit(0 if r.status == 200 and d.get('status') == 'UP' and d.get('modelLoaded') is True else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
