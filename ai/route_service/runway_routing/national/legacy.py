"""검증된 B2 스냅샷의 명시적 이전 계약. 새 자료는 build_prep로 만든다."""
import json

PREP_MANIFEST = 'ba9196f5e83937da9a91a7a5cf5c41c05863000170220e855cab0219ad0a7608'
STORE_MANIFEST = '80c6430e58e271966721292dc45f457709761102da2f0c2e2ba246a1f6c397f1'
COVERAGE = (124.3727348, 32.9104556, 132.1236111, 38.61772)
TIMESTAMP = '2026-10-20T20:23:47Z'
RUNTIME = json.loads(r'''{
    "runway_routing/graph.py":  "d70f9ea312d02f4cb28ef54260f7637eaa9c92b32216ccfd051a46ed93b9b195",
    "runway_routing/network_store.py":  "362b2f584b98e643404e0511e74aa6291ec9c78eba96e546bf1067c3b938d8c7",
    "runway_routing/substrate.py":  "284ec48002ce010f6c4795d7d849094504b2407c99f948be9e497366cf3bcf37",
    "runway_routing/array_graph.py":  "9eed0f6ced3d7806407ae248b2a8b4acfecc7b7ebf9ff66992e063b985e72f76",
    "runway_routing/snap.py":  "3a0522727bfb061125345c6cf5cc11bfe0efb4201dd127bd9f003120275e9ce9",
    "runway_routing/data.py":  "866d4ad48ea71c56c60100638059742c9e5eb8331365668247cc4da4e4ecf780",
    "runway_routing/national/prep.py":  "bc728ab32297a239b52dfc4b99f9fa14b285846b304593195ba9cb4358486bc1",
    "analysis/runway_walk_filter.py":  "252758f6ac39bf82f6e72570a615df2f260d3fd7a1b95dffa1de1359ee39d20f",
    "runway_routing/usability_gate.py":  "ac5509b380b0fc4e3c4205e7c6137b75b704b9ee669f9ffda5232f2e4b77174b",
    "runway_routing/config/ug-v1.json":  "c94506d81b283954b0a9a83170e25f15b34ffa00caf5eabd92096ef8d039cfc5"
}''')
# 607: app_target_km_range 15→21.1과 문구만 바뀜. prep은 ug-v2에서 PE4/PE5만 읽으므로 B2 prep 배열은 같다.
RUNTIME['runway_routing/config/ug-v2.json'] = '7e3d9cfbd13ca15bac2a2aaf5f252738373531721deeb8477f9f8c12d15349de'
# 621: np.unique → sorted_unique(같은 값·dtype), populate_adapter 벡터화(같은 값). prep 배열은 같다.
RUNTIME['runway_routing/substrate.py'] = '1a4e87269a9965d8352075e970d482f219641be56c0c12d092e6131c296dfc06'
RUNTIME['runway_routing/array_graph.py'] = 'a9d8bd869699eb9a16e7f08583296a3b642f3d68d9edce74237a8ac19d577076'
# 626: _build_routing의 pandas 정렬·pair_to_eid dict를 배열로(같은 redges·같은 조회). prep 배열은 같다.
RUNTIME['runway_routing/graph.py'] = 'c5093a2a7f1632c7296ca840c23b8d0ba396145948eac690371e368bb5d00812'
