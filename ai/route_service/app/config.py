"""환경변수 설정. 비밀값은 없다. 엔진 rollback 스위치(RUNWAY_SP_ENGINE 등)는 엔진이 import 시 직접 읽는다.

서비스가 읽는 값:
  ROUTE_DEBUG=1                 응답에 debug 블록을 넣는다(개발용, 기본 0)
  ROUTE_WARMUP=0                시작 시 예열 요청을 건너뛴다(기본 1; 0이면 엔진 로드만으로 ready)
  RUNWAY_USABILITY_GATE         enforce(기본) / shadow(비상용: 기록만)
  RUNWAY_FAST_GRAPH=0           canonical graph builder로 되돌린다(결과 동일, cold 느려짐)
  RUNWAY_USABILITY_LOG_DIR      Gate 검토 로그(JSONL) 폴더. 기본: <코드 root>/reports/_usability_gate_log
엔진이 읽는 값(참고): RUNWAY_DATA_DIR, RUNWAY_GRAPH_CACHE_SIZE, RUNWAY_MASK_CACHE_SIZE, RUNWAY_NETWORK_STORE,
  RUNWAY_SOURCE_SNAPSHOT, RUNWAY_SP_ENGINE, RUNWAY_SP_KERNEL, RUNWAY_ARRAY_LOOP, RUNWAY_ARRAY_SHAPES, RUNWAY_ARRAY_PAIR_FAST,
  RUNWAY_ENV_PREPARED, RUNWAY_ADAPTER_LEAN_ROUTING, RUNWAY_P2P_SUBSTRATE, NUMBA_CACHE_DIR.
"""
import os
from dataclasses import dataclass
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{name} must be 0 or 1")


@dataclass(frozen=True)
class Settings:
    debug: bool                 # 응답에 debug 블록 포함
    warmup: bool                # 시작 시 예열 요청 1회
    gate_mode: str              # Usability Gate: enforce / shadow
    fast_graph: bool            # fast graph builder
    usability_log_dir: Path     # Gate 검토 로그 폴더(쓰기 가능해야 함; 실패해도 응답은 막지 않음)


def load_settings() -> Settings:
    gate = os.getenv("RUNWAY_USABILITY_GATE", "enforce")
    log_dir = os.getenv("RUNWAY_USABILITY_LOG_DIR", "").strip()
    return Settings(
        debug=_flag("ROUTE_DEBUG", False),
        warmup=_flag("ROUTE_WARMUP", True),
        gate_mode=gate,
        fast_graph=os.getenv("RUNWAY_FAST_GRAPH", "1") != "0",
        usability_log_dir=Path(log_dir) if log_dir else SERVICE_DIR / "reports" / "_usability_gate_log",
    )
