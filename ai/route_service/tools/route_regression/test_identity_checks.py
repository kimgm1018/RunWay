"""S15P31E105-441 R5: service_identity.py와 compare.py가 빠진 시나리오·빠진 산출물·out key 순서 변경을 실패로 잡는지.

작은 합성 capture(데모 형식 A, 서비스 형식 B)를 임시 폴더에 만들어 두 도구를 그대로 실행한다(데이터 불필요).
수정 전 코드에서는 빈 capture, 시나리오 누락, out key 재배열이 모두 fails 0으로 통과했다.
"""
import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from service_identity import gate_files_sha256  # noqa: E402

OUT = [{"request": {"lat": 35.1, "lon": 129.1}, "canonical": {"graph": {"from_cache": False, "nodes": 3}}, "pool": [1, 2]}]
GATE = {"ts": "2026-11-05T10:00:00", "request": {"lat": 35.1}, "gate_version": {"config_version": "ug-v1+ug-v2"},
        "mode": "enforce", "top3": ["c1"]}
DEMO_OK = {"ok": True, "seed": 1, "next_seed": 25, "routes": [
    {"rank": 1, "coords": [[35.1, 129.1]], "distance_m": 5000.0, "summary": "s", "reasons": [], "caveats": [],
     "score": 1.0, "score_terms": [], "details": [], "features": {}}], "notices": []}


def _service_resp(demo):
    return {"routes": [{k: r[k] for k in ("rank", "coords", "distance_m", "summary", "reasons", "caveats", "score",
                                          "score_terms")} for r in demo["routes"]],
            "notices": demo["notices"], "next_seed": demo["next_seed"]}


def write_capture(d: Path, ids, service: bool, debug_ids=()):
    d.mkdir(parents=True)
    items = []
    for sid in ids:
        (d / f"{sid}.resp.json").write_text(json.dumps(_service_resp(DEMO_OK) if service else DEMO_OK), encoding="utf-8")
        (d / f"{sid}.out.json").write_text(json.dumps(OUT), encoding="utf-8")
        line = dict(GATE)
        if service:   # the service writes gate_files_sha256 right after gate_version (R10)
            line = {}
            for k, v in GATE.items():
                line[k] = v
                if k == "gate_version":
                    line["gate_files_sha256"] = gate_files_sha256()
        (d / f"{sid}.gate.jsonl").write_text(json.dumps(line) + "\n", encoding="utf-8")
        items.append({"id": sid, "http": 200, "elapsed_s": 0.1, "runs": 1, "gate_lines": 1})
    for sid in debug_ids:
        (d / f"{sid}.resp.json").write_text("{}", encoding="utf-8")
        items.append({"id": sid, "http": 200, "elapsed_s": 0.1})
    (d / "meta.json").write_text(json.dumps({"items": items}), encoding="utf-8")
    for f in ("status_start.json", "status_end.json"):
        (d / f).write_text('{"ready": true}', encoding="utf-8")


def run(tool, a, b):
    r = subprocess.run([sys.executable, "-B", str(HERE / tool), str(a), str(b)], capture_output=True, text=True,
                       encoding="utf-8", cwd=HERE)
    head = json.loads(r.stdout.splitlines()[0])
    return r.returncode, head, r.stdout


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ident441_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class ServiceIdentity(Base):
    IDS = ["GS-01", "GS-02", "GS-03"]

    def test_full_capture_passes(self):
        write_capture(self.tmp / "A", self.IDS, service=False, debug_ids=["D-01", "D-02"])
        write_capture(self.tmp / "B", self.IDS, service=True)
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual((rc, head["fails"], head["compared"], head["gate_identical"]), (0, 0, 3, 3), out)

    def test_empty_capture_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", [], service=True)
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)
        self.assertIn("scenarios missing in B", out)
        self.assertIn("nothing compared", out)

    def test_one_scenario_missing_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", ["GS-01", "GS-03"], service=True)
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)
        self.assertIn("('scenarios missing in B', ['GS-02'])", out)

    def test_out_keys_reordered_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", self.IDS, service=True)
        o = copy.deepcopy(OUT)
        o[0]["canonical"] = {"graph": {"nodes": 3, "from_cache": False}}       # same values, other key order
        (self.tmp / "B" / "GS-02.out.json").write_text(json.dumps(o), encoding="utf-8")
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)
        self.assertIn("key order", out)

    def test_missing_artifact_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", self.IDS, service=True)
        (self.tmp / "B" / "GS-03.gate.jsonl").unlink()
        (self.tmp / "A" / "GS-03.gate.jsonl").unlink()      # both sides missing used to be skipped
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)
        self.assertIn("missing artifacts", out)

    def test_gate_line_without_rule_hashes_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", self.IDS, service=False)          # B written like the demo: no gate_files_sha256
        for sid in self.IDS:
            (self.tmp / "B" / f"{sid}.resp.json").write_text(json.dumps(_service_resp(DEMO_OK)), encoding="utf-8")
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual((rc, head["gate_identical"]), (1, 0), out)

    def test_scenario_order_differs_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", list(reversed(self.IDS)), service=True)
        rc, head, out = run("service_identity.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)
        self.assertIn("scenario order differs", out)


class Compare(Base):
    IDS = ["GS-01", "GS-02"]

    def test_same_capture_passes(self):
        write_capture(self.tmp / "A", self.IDS, service=False, debug_ids=["D-01"])
        write_capture(self.tmp / "B", self.IDS, service=False, debug_ids=["D-01"])
        rc, head, out = run("compare.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual((rc, head["fails"]), (0, 0), out)

    def test_empty_capture_fails(self):
        write_capture(self.tmp / "A", [], service=False)
        write_capture(self.tmp / "B", [], service=False)
        rc, head, out = run("compare.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)

    def test_one_scenario_missing_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", ["GS-01"], service=False)
        rc, head, out = run("compare.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)

    def test_out_keys_reordered_fails(self):           # was info "out_keyorder_diff" only
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", self.IDS, service=False)
        o = copy.deepcopy(OUT)
        o[0] = {"canonical": o[0]["canonical"], "request": o[0]["request"], "pool": o[0]["pool"]}
        (self.tmp / "B" / "GS-01.out.json").write_text(json.dumps(o), encoding="utf-8")
        rc, head, out = run("compare.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual((rc, head["out_keyorder_diff"]), (1, ["GS-01"]), out)

    def test_required_artifact_missing_on_both_sides_fails(self):
        write_capture(self.tmp / "A", self.IDS, service=False)
        write_capture(self.tmp / "B", self.IDS, service=False)
        for d in ("A", "B"):
            (self.tmp / d / "GS-02.out.json").unlink()
        rc, head, out = run("compare.py", self.tmp / "A", self.tmp / "B")
        self.assertEqual(rc, 1, out)
        self.assertIn("missing in both", out)


if __name__ == "__main__":
    unittest.main()
