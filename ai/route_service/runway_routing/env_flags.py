"""On/off rollback switches read from the environment: one rule for every engine flag (S15P31E105-441 R11).

Rule: unset -> the default (normal path); "1" -> on; "0" -> off; anything else (e.g. "false", "off", " 0", "") ->
ValueError naming the variable. Before, most flags were off only for exactly "0", so a typo such as "false" silently
kept the normal path; RUNWAY_ARRAY_LOOP / RUNWAY_ARRAY_SHAPES already used this strict rule.
Normal values ("0", "1", unset) behave exactly as before.

RUNWAY_SP_ASTAR (shortest_path.py), RUNWAY_FAST_ROUTING, RUNWAY_FAST_EDGE_ARRAYS and RUNWAY_TRAFFIC_DIST_FAST (graph.py), RUNWAY_GATE_FAST_CONTEXT
(gate.py), RUNWAY_ARRAY_PAIR_KERNELS and RUNWAY_ADAPTER_REUSE (array_graph.py), RUNWAY_P2P_MASK_FAST (substrate.py), all
default 1, use this rule.
Not covered here on purpose: RUNWAY_SP_ENGINE / RUNWAY_SP_KERNEL (enums, shortest_path.py), RUNWAY_NETWORK_STORE /
RUNWAY_SOURCE_SNAPSHOT ("0" = off, otherwise a directory path), RUNWAY_GRAPH_CACHE_SIZE / RUNWAY_MASK_CACHE_SIZE
(integers, graph.cache_size_env), RUNWAY_ARRAY_LOOP / RUNWAY_ARRAY_PAIR_FAST (same rule, parsed in array_graph.py), and the service flags
ROUTE_DEBUG / ROUTE_WARMUP (app/config.py, also accept true/false/yes/no/on/off).
"""
import os


def flag(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    if raw not in ("0", "1"):
        raise ValueError(f"{name} must be 0 or 1 (got {raw!r}); unset it for the default ({int(default)})")
    return raw == "1"
