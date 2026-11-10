"""시연 재생 샘플 도구가 현재 정책·후보로 개인·그룹 기록을 만드는지 확인한다(S15P31E105-642)."""
import json

from app.pace_selector import DELTAS
from app.policy.config import load_policy_config
from tools.make_demo_samples import GROUP_ID, PERSONAL_ID, make_samples


def test_samples_use_current_policy_and_candidates(tmp_path):
    (tmp_path / "index.js").write_text('window.RunwayDemoRecordingFiles = ["old.js"];\n', encoding="utf-8")
    result = make_samples(tmp_path, minutes=11)
    version = load_policy_config().policy_version
    personal, group = result["personal"], result["group"]
    assert personal["policyVersion"] == version and group["policyVersion"] == version
    with_candidates = [t for t in personal["traces"] if t["candidates"]]
    assert with_candidates and all([c["deltaSecPerKm"] for c in t["candidates"]] == list(DELTAS) for t in with_candidates)
    assert any(c["passed"] is False for t in with_candidates for c in t["candidates"])        # 탈락 후보가 보인다
    assert any(t["decision"]["reason"] == "SLOW_DOWN_HR" for t in personal["traces"] if t["decision"])
    assert [c["deltaSecPerKm"] for c in group["traces"][0]["group"]["candidates"]] == list(DELTAS)
    assert personal["snapshot"]["course"]["points"]                                        # 코스 지도가 있다
    index = (tmp_path / "index.js").read_text(encoding="utf-8")
    names = json.loads(index.split("=", 1)[1].rstrip().rstrip(";"))
    assert names == [PERSONAL_ID + ".js", GROUP_ID + ".js", "old.js"]                      # 개인이 기본 선택
