"""AI04 추천 페이스를 사용자의 목표 BPM으로 바꾼다.

보폭 모델과 BPM 규칙은 ai/bpm/target_bpm.py를 그대로 불러 쓴다(새로 만들지 않는다).
GRU 코드처럼 폴더를 sys.path에 넣고 import한다. 폴더는 BPM_SRC_DIR(기본 ../bpm, ai/service 기준)이다.

한 번의 판단에서 하는 일:
  - 지난 기록이 있으면: select_records(BPM을 따라간 구간만, 최근 20회) → target_bpm
  - 지난 기록이 없으면(처음 사용자): 평균 직선 BPM, 이번 러닝 첫 1분이 오면 first_minute_bpm으로 한 번 보정
AI 서비스는 상태를 저장하지 않는다. 백엔드가 같은 첫 1분 구간을 매번 보내면 매번 같은 결과가 나오므로
보정이 반복되거나 쌓이지 않고, 목표 페이스가 바뀌어도 첫 1분 보정이 그대로 이어진다.
"""
import os
import sys
from pathlib import Path

from app.config import SERVICE_DIR

CUE_BPM_UNAVAILABLE = "CUE_BPM_UNAVAILABLE"


def bpm_src_dir() -> Path:
    value = Path(os.getenv("BPM_SRC_DIR", "../bpm").strip()).expanduser()
    return value if value.is_absolute() else (SERVICE_DIR / value).resolve()


class CueBpmCalculator:
    def __init__(self, src_dir: Path | None = None):
        src = src_dir or bpm_src_dir()
        if str(src) not in sys.path:
            sys.path.insert(0, str(src))
        import target_bpm   # noqa: E402  (BPM_SRC_DIR의 ai/bpm/target_bpm.py)
        self._tb = target_bpm
        self.prior = target_bpm.StridePrior.load(src / "stride_prior.json")

    def compute(self, pace_sec_per_km: float, bpm_input) -> int:
        """bpm_input: 요청의 context.bpm(없으면 None). 60~220 정수 BPM을 돌려준다."""
        tb = self._tb
        past = [tb.Window(r.run_no, r.speed_mps, r.cadence_spm, r.cue_bpm)
                for r in (bpm_input.records if bpm_input else [])]
        records = tb.select_records(past)
        base = tb.target_bpm(pace_sec_per_km, self.prior, records=records)
        first = bpm_input.first_minute if bpm_input else None
        if records or first is None:
            return base.bpm
        window = tb.Window(0, first.speed_mps, first.cadence_spm, first.cue_bpm)
        changed = tb.first_minute_bpm(base.bpm, pace_sec_per_km, window, [], self.prior)
        return changed.bpm if changed else base.bpm


class UnavailableCueBpm:
    """시작할 때 BPM 모듈을 못 불러왔을 때 쓴다. 응답마다 BPM null + 경고가 붙는다."""

    def compute(self, pace_sec_per_km, bpm_input) -> int:
        raise RuntimeError("BPM 모듈을 불러오지 못했습니다")