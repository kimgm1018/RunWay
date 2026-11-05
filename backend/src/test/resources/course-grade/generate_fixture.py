"""Regenerate from the real AI implementation, from the repository root:

uv run --python 3.12 --with numpy==2.5.2 --with pydantic==2.14.1 \
    python backend/src/test/resources/course-grade/generate_fixture.py

No Java implementation is used to derive expected values. Inputs are synthetic.
"""
import hashlib
import json
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "ai/service"))
from app.course_grade import elevation_to_grade_profile
import numpy
import pydantic

cases = [
    ("flat", 1000.0, [0, 1000], [20, 20]),
    ("uphill", 2000.0, [0, 2000], [0, 100]),
    ("downhill", 2000.0, [0, 2000], [100, 0]),
    ("irregular", 1000.0, [0, 123, 505, 999, 1000], [10, 20, 12, 70, 70]),
    ("short", 150.0, [0, 150], [0, 3]),
    ("underMean", 0.01, [0, 0.01], [1, 1.001]),
    ("underMedian", 39.99, [0, 39.99], [0, 1]),
    ("medianBoundary", 80.0, [0, 80], [0, 4]),
    ("exact45km", 45000.0, [0, 45000], [0, 50]),
    ("over45km", 45000.01, [0, 45000.01], [0, 50]),
    ("long", 50000.0, [0, 12345, 50000], [30, 100, 20]),
    ("spike", 1000.0, list(range(0, 1001, 20)),
     [30 if x == 500 else 10 for x in range(0, 1001, 20)]),
]
rng = random.Random(369)
for index in range(12):
    distance = round(rng.uniform(100, 15000), 2)
    xs = [0.0] + sorted(rng.uniform(0, distance) for _ in range(15)) + [distance]
    zs = [rng.uniform(10, 80) for _ in xs]
    cases.append((f"seed369-{index}", distance, xs, zs))

output = []
for name, distance, xs, zs in cases:
    raw = [{"distanceM": x, "elevationM": z} for x, z in zip(xs, zs)]
    profile = elevation_to_grade_profile(distance, raw)
    assert profile and all(abs(p.grade_percent) <= 100 for p in profile)
    output.append({"name": name, "distanceM": distance, "distancesM": xs,
                   "elevationsM": zs, "expected": [p.model_dump(by_alias=True, exclude_none=True)
                                                    for p in profile]})
fixture = {"sourceSha256": hashlib.sha256((ROOT / "ai/service/app/course_grade.py").read_bytes()).hexdigest(),
           "numpy": numpy.__version__, "pydantic": pydantic.__version__, "cases": output}
Path(__file__).with_name("python-grade.json").write_text(
    json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Generated {len(output)} comparison cases using app.course_grade")
