"""신규 사용자용 평균(중앙값) 개인화 묶음. 모델 파일처럼 배포 때 따로 받아 시작 시 sha256을 검사한다.

- 파일: env ODEV21_POPULATION_BUNDLE_PATH / ODEV21_POPULATION_BUNDLE_SHA256(필수, 다르면 시작 실패)
- 모드: env PERSONAL_PLAN_POPULATION_MODE
    median_bundle(기본) : 묶음 payload(userId만 요청값)를 개인 ODE 계획과 같은 경로로 계획
    empty               : P4·history·요약을 비운 G0(학습 때 배운 결측 경로). HR0는 묶음 값
    off                 : 평균 경로 없음(기존 503)
- 묶음의 hrRefBpm은 기준 HR로 쓰지 않는다. 기준 HR은 모집단 학습값과 저장된 개인 학습값으로 만든다.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path

POPULATION_MODES = ("median_bundle", "empty", "off")
DEFAULT_POPULATION_MODE = "median_bundle"
EMPTY_MODE_POLICY_VERSION = "v2train-empty-g0-v1"


@dataclass(frozen=True)
class PopulationBundle:
    payload: dict
    sha256: str
    model_version: str
    policy_version: str
    train_subject_count: int
    train_run_count: int
    source: str


def load_population_mode() -> str:
    value = os.getenv("PERSONAL_PLAN_POPULATION_MODE", DEFAULT_POPULATION_MODE).strip().lower()
    if value not in POPULATION_MODES:
        raise ValueError(f"PERSONAL_PLAN_POPULATION_MODE는 {'|'.join(POPULATION_MODES)} 중 하나여야 합니다: {value}")
    return value


def _finite_rows(value, width: int | None) -> bool:
    if not isinstance(value, list) or not value:
        return False
    rows = value if width is not None else [value]
    for row in rows:
        if not isinstance(row, list) or (width is not None and len(row) != width):
            return False
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in row):
            return False
    return True


def load_population_bundle(path: str, expected_sha256: str) -> PopulationBundle:
    """sha256과 형식을 검사해 읽는다. 맞지 않으면 ValueError(시작 실패)."""
    data = Path(path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if not expected_sha256 or digest != expected_sha256.strip().lower():
        raise ValueError("ODEV21_POPULATION_BUNDLE_SHA256이 묶음 파일과 다릅니다")
    payload = json.loads(data.decode("utf-8"))
    population = payload.get("population") if isinstance(payload, dict) else None
    hr0 = payload.get("hr0SubBpm") if isinstance(payload, dict) else None
    if (not isinstance(payload, dict) or payload.get("schemaVersion") != "runway.ode.personalization.v1"
            or not payload.get("modelVersion") or not isinstance(payload.get("summaryU"), dict)
            or not payload.get("summaryU")
            or not _finite_rows(payload.get("p4"), None) or len(payload["p4"]) != 4
            or not _finite_rows(payload.get("history8"), 5) or len(payload["history8"]) > 512
            or isinstance(hr0, bool) or not isinstance(hr0, (int, float)) or not 35 <= float(hr0) <= 220
            or not isinstance(population, dict)
            or int(population.get("trainSubjectCount") or 0) <= 0
            or int(population.get("trainRunCount") or 0) <= 0):
        raise ValueError("평균 묶음 파일의 schema·modelVersion·입력 배열·provenance가 올바르지 않습니다")
    return PopulationBundle(
        payload=payload, sha256=digest, model_version=str(payload["modelVersion"]),
        policy_version=str(population.get("policy") or "v2train-per-user-median-v1"),
        train_subject_count=int(population["trainSubjectCount"]),
        train_run_count=int(population["trainRunCount"]),
        source=str(population.get("source") or "V2_TRAIN"),
    )


__all__ = ["DEFAULT_POPULATION_MODE", "EMPTY_MODE_POLICY_VERSION", "POPULATION_MODES", "PopulationBundle",
           "load_population_bundle", "load_population_mode"]
