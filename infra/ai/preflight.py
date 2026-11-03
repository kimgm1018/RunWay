"""서비스 교체 전에 격리된 실행 이미지에서 모델 묶음과 실제 로드를 확인한다."""
import asyncio
import hashlib
import os
from pathlib import Path


def check_file(path_name, sha_name):
    path, expected = os.environ.get(path_name, ""), os.environ.get(sha_name, "")
    if not path or len(expected) != 64:
        raise RuntimeError("필수 모델 경로·SHA 설정 누락")
    with Path(path).open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise RuntimeError("모델 SHA-256 불일치")


for path_name, sha_name in (
    ("HR_MODEL_PATH", "HR_MODEL_SHA256"),
    ("ODEV21_CHECKPOINT_PATH", "ODEV21_CHECKPOINT_SHA256"),
    ("ODEV21_SUMMARY_STATS_PATH", "ODEV21_SUMMARY_STATS_SHA256"),
    ("ODEV21_POPULATION_BUNDLE_PATH", "ODEV21_POPULATION_BUNDLE_SHA256"),
):
    check_file(path_name, sha_name)

# 앱 시작 과정에서 평균 bundle 형식·모델 버전 일치와 ODE 예열도 확인한다.
from app.main import app


async def verify():
    async with app.router.lifespan_context(app):
        if app.state.model is None or app.state.ode_model is None or app.state.policy is None:
            raise RuntimeError("GRU·ODE·판단 정책 모두 준비되어야 배포 가능")


asyncio.run(verify())
print("모델 4개 SHA-256·GRU·ODE 로드 사전 검증 통과")
