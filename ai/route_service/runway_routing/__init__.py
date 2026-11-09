"""RunWay running-course recommendation backend. Start with pipeline.py (the whole request flow on one screen).

    pipeline.py        RoutePipeline: LOOP / OUT_AND_BACK / POINT_TO_POINT -> generate -> features -> score -> gate
    data.py            external data (OSM extract, env layer, env edge cache, DEM, config/) and loading
    graph.py           per-request routing graph (canonical disk graph, fast builder, env / edge arrays, cache)
    snap.py            start / destination snapping rules
    substrate.py       the extract as flat arrays + exact disk masks (P2P's two app-max disks without networkx)
    shortest_path.py   route_through's search: networkx 3.7 bidirectional Dijkstra, ported exactly (D-exact)
    candidates.py      candidate generation (canonical LOOP + preference bias, OAB, P2P, P2P distance rule)
    features.py        route features, validity, Running Suitability components
    scorer.py          rule-based score, suitability term, rank + dedupe
    gate.py            Usability Gate adapter (PASS / REVIEW / FAIL, Stage B)
    usability_gate.py  frozen Usability Gate rule engine (ug-v1 + ug-v2; never edit)
    explain.py         plain-language reasons per route
    config/            JSON configs (values frozen; config/CONFIG_NOTES.md lists the ones production does not read)
The canonical generator lives in analysis/ (another workstream, read only; five modules are imported at runtime).
Data-build tools are in tools/data/, the golden regression in tools/route_regression/ (see ../README.md).

rollback 환경변수 전체(11개)·읽는 시점·허용 값은 ../README.md 7절이 정본이다(on/off 스위치는 env_flags.py 규칙).
기본은 부산 extract다. ROUTE_DATA_MODE=national은 national/의 별도 전국 store에서 요청별 창을 읽는다.
"""
