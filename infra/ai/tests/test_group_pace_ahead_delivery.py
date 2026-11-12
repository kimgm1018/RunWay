from __future__ import annotations

from test_feature_flag_delivery import _compose_environment


def test_compose_passes_group_pace_ahead_off_by_default():
    # S15P31E105-728: AI10 여유 가속은 배포 기본도 꺼짐. 시연 때 켠다.
    env = _compose_environment()
    assert env.get("GROUP_PACE_AHEAD_ENABLED") == "${GROUP_PACE_AHEAD_ENABLED:-false}"
    assert env.get("GROUP_PACE_AHEAD_WAIT_SEC") == "${GROUP_PACE_AHEAD_WAIT_SEC:-180}"
