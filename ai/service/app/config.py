"""환경변수 설정. 비밀값은 없다. 상대 경로는 ai/service/ 기준이다."""
import os
from dataclasses import dataclass
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent


def _path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (SERVICE_DIR / path).resolve()


@dataclass(frozen=True)
class Settings:
    model_type: str           # HR 예측 모델 종류 (현재 gru)
    model_path: Path          # 체크포인트 파일
    model_sha256: str | None  # 주면 시작할 때 체크포인트 SHA256을 확인한다
    gru_src_dir: Path         # GRU predictor 코드 폴더
    device: str               # cpu 또는 cuda
    torch_threads: int        # CPU 추론 스레드 수


def load_settings() -> Settings:
    return Settings(
        model_type=os.getenv("HR_MODEL_TYPE", "gru").strip().lower(),
        model_path=_path(os.getenv("HR_MODEL_PATH", "models/gru_final.pt")),
        model_sha256=os.getenv("HR_MODEL_SHA256", "").strip().lower() or None,
        gru_src_dir=_path(os.getenv("HR_GRU_SRC_DIR", "../workspace/doyeon/gru/src")),
        device=os.getenv("HR_DEVICE", "cpu").strip(),
        torch_threads=int(os.getenv("TORCH_NUM_THREADS", "4")),
    )
