"""OpenAPI 경로가 기준 문서(ai-service.md)에 있고 라우트마다 요약·태그·오류 응답이 있는지 확인한다."""
import re
from pathlib import Path

import pytest

from app.main import app

_DOCUMENT = Path(__file__).resolve().parents[3] / "docs" / "design" / "api" / "ai-service.md"


def _normalize_path_parameters(value):
    return re.sub(r"\{[^{}]+\}", "{}", value)


# ai-ci 테스트 이미지에는 docs/가 들어가지 않는다(infra/ai/Dockerfile.dockerignore). 저장소 체크아웃에서만 확인한다.
@pytest.mark.skipif(not _DOCUMENT.is_file(), reason="docs/ 없음(AI 테스트 이미지)")
def test_non_demo_openapi_paths_are_documented():
    document_path = _DOCUMENT
    document =_normalize_path_parameters(document_path.read_text(encoding="utf-8"))

    for path in app.openapi()["paths"]:
        if path.startswith("/v1/demo/"):
            continue
        assert _normalize_path_parameters(path) in document


def test_every_openapi_route_has_summary_and_tag():
    for path, path_item in app.openapi()["paths"].items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                continue
            assert operation.get("summary"), f"{method.upper()} {path} 요약이 없습니다"
            assert operation.get("tags"), f"{method.upper()} {path} 태그가 없습니다"


def test_ai03_to_ai09_openapi_error_statuses_match_documented_contract():
    paths = app.openapi()["paths"]
    expected = {
        "/v1/hr/predict": {"400", "422", "500", "503"},
        "/v1/pace/decide": {"400", "422", "500", "503"},
        "/v1/pace/plan": {"400", "422", "500", "503"},
        "/v1/hr/personalize": {"400", "422", "500", "503"},
        "/v1/pace/personal-plan": {"400", "404", "422", "503"},
    }

    for path, required in expected.items():
        responses = paths[path]["post"]["responses"]
        assert required.issubset(responses), f"{path} 오류 응답이 부족합니다"

    ai06_schema = paths["/v1/hr/personalize"]["post"]["responses"]["500"]["content"]["application/json"]["schema"]
    assert {"detail", "gruPersonalization", "warnings", "hrDangerBpm", "hrSustainBpm",
            "hrThresholdRunCount"}.issubset(ai06_schema["properties"])


def test_no_ai10_segment_ratio_endpoint():
    # 2026-11-06 결정: 백엔드는 AI09 paceRatio만 쓴다. 별도 AI10 비율 API를 두지 않는다.
    assert "/v1/pace/segment-ratios" not in app.openapi()["paths"]
