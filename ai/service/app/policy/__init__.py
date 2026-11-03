"""MPC 정책 v0.4 구성요소."""
from pathlib import Path

from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from app.policy.residual_margin import load_margin_table


def build_policy(margin_table_path: Path | None, model_type: str) -> MpcPolicy:
    """선택된 예측기 계열과 같은 여유 표로 정책을 만든다."""
    if margin_table_path is None or not margin_table_path.is_file():
        raise FileNotFoundError("MPC 여유 표가 없습니다")
    margins = load_margin_table(margin_table_path)
    family = margins.model.lower().split("-", 1)[0]
    if family != model_type.strip().lower():
        raise ValueError("여유 표의 모델 계열과 HR_MODEL_TYPE이 다릅니다")
    return MpcPolicy(load_policy_config(), margins)


__all__ = ["MpcPolicy", "build_policy"]
