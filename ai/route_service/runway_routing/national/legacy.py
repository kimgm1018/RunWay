"""검증된 B2 스냅샷의 명시적 이전 계약. 새 자료는 build_prep로 만든다."""
import json

PREP_MANIFEST = 'ba9196f5e83937da9a91a7a5cf5c41c05863000170220e855cab0219ad0a7608'
STORE_MANIFEST = '80c6430e58e271966721292dc45f457709761102da2f0c2e2ba246a1f6c397f1'
COVERAGE = (124.3727348, 32.9104556, 132.1236111, 38.61772)
TIMESTAMP = '2026-10-20T20:23:47Z'
RUNTIME = json.loads(r'''{
    "runway_routing/graph.py":  "fedbdca6eac24b93637867b7a624b261ae1e29169259648757a03e53d9687518",
    "runway_routing/network_store.py":  "362b2f584b98e643404e0511e74aa6291ec9c78eba96e546bf1067c3b938d8c7",
    "runway_routing/substrate.py":  "284ec48002ce010f6c4795d7d849094504b2407c99f948be9e497366cf3bcf37",
    "runway_routing/array_graph.py":  "9eed0f6ced3d7806407ae248b2a8b4acfecc7b7ebf9ff66992e063b985e72f76",
    "runway_routing/snap.py":  "3a0522727bfb061125345c6cf5cc11bfe0efb4201dd127bd9f003120275e9ce9",
    "runway_routing/data.py":  "866d4ad48ea71c56c60100638059742c9e5eb8331365668247cc4da4e4ecf780",
    "runway_routing/national/prep.py":  "bc728ab32297a239b52dfc4b99f9fa14b285846b304593195ba9cb4358486bc1",
    "analysis/runway_walk_filter.py":  "252758f6ac39bf82f6e72570a615df2f260d3fd7a1b95dffa1de1359ee39d20f",
    "runway_routing/usability_gate.py":  "ac5509b380b0fc4e3c4205e7c6137b75b704b9ee669f9ffda5232f2e4b77174b",
    "runway_routing/config/ug-v1.json":  "c94506d81b283954b0a9a83170e25f15b34ffa00caf5eabd92096ef8d039cfc5",
    "runway_routing/config/ug-v2.json":  "9a14a79f7f760aeff2d54309c36576b0fc89e669da16f9d8410353f2175e57f3"
}''')
