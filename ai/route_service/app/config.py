"""환경변수 설정. 비밀값은 없다. 엔진 rollback 스위치(RUNWAY_SP_ENGINE 등)는 엔진이 import 시 직접 읽는다.

서비스가 읽는 값:
  ROUTE_DEBUG=1                 응답에 debug 블록을 넣는다(개발용, 기본 0)
  ROUTE_WARMUP=0                시작 시 예열 요청을 건너뛴다(기본 1; 0이면 엔진 로드만으로 ready)
  ROUTE_LOCK_WAIT_S             실행 슬롯 대기 상한(초, 기본 8.0, 유한한 양수만 허용)
  RUNWAY_USABILITY_GATE         enforce(기본) / shadow(비상용: 기록만)
  RUNWAY_FAST_GRAPH=0           canonical graph builder로 되돌린다(결과 동일, cold 느려짐)
  RUNWAY_USABILITY_LOG_DIR      Gate 검토 로그(JSONL) 폴더. 기본: <코드 root>/reports/_usability_gate_log
  ROUTE_REROLL_EXCLUDE=0        재추천에서 이전 코스 제외를 끈다(기본 1; 끄면 seed만 바꾸는 예전 재추천, S15P31E105-383)
  ROUTE_REROLL_CACHE_SIZE       재추천 제외용 코스 결과 cache 칸 수(기본 256, TTL 10분, 0이면 cache 없이 매번 다시 계산)
  ROUTE_RESPONSE_CACHE=0        추천 성공 응답 cache를 끈다(기본 1, S15P31E105-630, app/response_cache.py)
  ROUTE_RESPONSE_CACHE_SIZE     추천 성공 응답 cache 칸 수(기본 32, 0이면 끔)
  ROUTE_RESPONSE_CACHE_TTL_S    추천 성공 응답 cache 유지 시간(초, 기본 600, 유한한 양수만 허용)
  ROUTE_RELEASE_ANON_MIB        다른 조건 요청 전 graph 캐시를 비울 익명 메모리 기준(MiB, 기본 1024, 0이면 항상 비움)
엔진이 읽는 값(참고): RUNWAY_DATA_DIR, RUNWAY_GRAPH_CACHE_SIZE, RUNWAY_MASK_CACHE_SIZE, RUNWAY_NETWORK_STORE,
  RUNWAY_SOURCE_SNAPSHOT, RUNWAY_SP_ENGINE, RUNWAY_SP_KERNEL, RUNWAY_SP_ASTAR, RUNWAY_ARRAY_LOOP, RUNWAY_ARRAY_SHAPES, RUNWAY_ARRAY_PAIR_FAST,
  RUNWAY_ENV_PREPARED, RUNWAY_ADAPTER_LEAN_ROUTING, RUNWAY_FAST_ROUTING, RUNWAY_GATE_FAST_CONTEXT, RUNWAY_P2P_SUBSTRATE,
  NUMBA_CACHE_DIR.
"""
import math
import os
from dataclasses import dataclass
from pathlib import Path

from runway_routing.env_flags import flag as env_flag

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
    reroll_exclude: bool = True     # 재추천에서 이전 1~2개 응답의 코스 제외
    reroll_cache_size: int = 256    # 그 비교용 코스 결과 cache 칸 수
    lock_wait_s: float = 8.0        # 실행 슬롯 대기 상한(초)
    data_mode: str = 'busan'
    national_dir: Path | None = None
    window_cache_size: int = 1
    release_anon_mib: float = 1024.0
    response_cache: bool = True         # 추천 성공 응답 cache(S15P31E105-630). 끄면 매번 계산(예전 동작)
    response_cache_size: int = 32       # 그 cache 칸 수(0이면 끔)
    response_cache_ttl_s: float = 600.0  # 그 cache 유지 시간(초)

    def __post_init__(self):
        if self.data_mode not in ('busan', 'national'):
            raise ValueError('ROUTE_DATA_MODE must be busan or national')
        if not isinstance(self.window_cache_size, int) or isinstance(self.window_cache_size, bool) or self.window_cache_size < 1:
            raise ValueError('ROUTE_WINDOW_CACHE_SIZE must be an integer >= 1')
        if (not isinstance(self.release_anon_mib, (int, float)) or isinstance(self.release_anon_mib, bool)
                or not math.isfinite(self.release_anon_mib) or self.release_anon_mib < 0):
            raise ValueError('ROUTE_RELEASE_ANON_MIB must be a finite number >= 0')
        if (not isinstance(self.response_cache_size, int) or isinstance(self.response_cache_size, bool)
                or self.response_cache_size < 0):
            raise ValueError('ROUTE_RESPONSE_CACHE_SIZE must be an integer >= 0')
        if (not isinstance(self.response_cache_ttl_s, (int, float)) or isinstance(self.response_cache_ttl_s, bool)
                or not math.isfinite(self.response_cache_ttl_s) or self.response_cache_ttl_s <= 0):
            raise ValueError('ROUTE_RESPONSE_CACHE_TTL_S must be a finite number > 0')
        if self.data_mode == 'national' and (self.national_dir is None or not self.national_dir.is_dir()):
            raise ValueError('ROUTE_NATIONAL_DIR must be an existing directory in national mode')


def load_settings() -> Settings:
    gate = os.getenv("RUNWAY_USABILITY_GATE", "enforce")
    log_dir = os.getenv("RUNWAY_USABILITY_LOG_DIR", "").strip()
    try:
        lock_wait_s = float(os.getenv("ROUTE_LOCK_WAIT_S", "8.0"))
    except ValueError:
        raise ValueError("ROUTE_LOCK_WAIT_S must be a finite number > 0") from None
    if not math.isfinite(lock_wait_s) or lock_wait_s <= 0:
        raise ValueError("ROUTE_LOCK_WAIT_S must be a finite number > 0")
    try:
        release_anon_mib = float(os.getenv('ROUTE_RELEASE_ANON_MIB', '1024'))
    except ValueError:
        raise ValueError('ROUTE_RELEASE_ANON_MIB must be a finite number >= 0') from None
    try:
        response_cache_size = int(os.getenv('ROUTE_RESPONSE_CACHE_SIZE', '32'))
    except ValueError:
        raise ValueError('ROUTE_RESPONSE_CACHE_SIZE must be an integer >= 0') from None
    try:
        response_cache_ttl_s = float(os.getenv('ROUTE_RESPONSE_CACHE_TTL_S', '600'))
    except ValueError:
        raise ValueError('ROUTE_RESPONSE_CACHE_TTL_S must be a finite number > 0') from None
    return Settings(
        debug=_flag("ROUTE_DEBUG", False),
        warmup=_flag("ROUTE_WARMUP", True),
        gate_mode=gate,
        fast_graph=env_flag("RUNWAY_FAST_GRAPH"),     # 0/1만 허용(runway_routing/env_flags.py)
        usability_log_dir=Path(log_dir) if log_dir else SERVICE_DIR / "reports" / "_usability_gate_log",
        reroll_exclude=_flag("ROUTE_REROLL_EXCLUDE", True),
        reroll_cache_size=int(os.getenv("ROUTE_REROLL_CACHE_SIZE", "256")),
        lock_wait_s=lock_wait_s,
        data_mode=os.getenv('ROUTE_DATA_MODE', 'busan'),
        national_dir=Path(os.environ['ROUTE_NATIONAL_DIR']) if os.getenv('ROUTE_NATIONAL_DIR', '').strip() else None,
        window_cache_size=int(os.getenv('ROUTE_WINDOW_CACHE_SIZE', '1')),
        release_anon_mib=release_anon_mib,
        response_cache=_flag('ROUTE_RESPONSE_CACHE', True),
        response_cache_size=response_cache_size,
        response_cache_ttl_s=response_cache_ttl_s,
    )
