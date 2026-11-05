"""Canonical NetworkX 3.7 component metadata without constructing a graph.

The input is an ordered RouteCSR of a simple undirected graph, with Python int
node ids and Python float edge lengths. Node and adjacency orders must match H.
Python set construction and built-in sum intentionally mirror the canonical
operations: both component item order and floating-point sums are observable.
"""


def component_layout(csr):
    """Return ``(comp, comp_km)`` in ``route_graph_fast``'s exact order.

    This preserves NetworkX 3.7 BFS set insertion, subgraph view iteration,
    undirected edge reporting (including self-loops), and stable length sorting.
    No NetworkX imports or graph construction are required.
    """
    ids, index = csr.ids, csr.index
    ptr, nbr, ned, length = csr.ptr, csr.nbr, csr.ned, csr.length
    count = len(ids)
    visited = set()
    raw = []
    for source in ids:
        if source in visited:
            continue
        remaining = count - len(visited)
        seen = {source}
        nextlevel = [source]
        while nextlevel:
            thislevel = nextlevel
            nextlevel = []
            complete = False
            for node in thislevel:
                i = index[node]
                for arc in range(ptr[i], ptr[i + 1]):
                    neighbor = ids[nbr[arc]]
                    if neighbor not in seen:
                        seen.add(neighbor)
                        nextlevel.append(neighbor)
                if len(seen) == remaining:
                    complete = True
                    break
            if complete:
                break
        visited.update(seen)
        raw.append(seen)

    def component_lengths(component):
        # Graph.subgraph -> show_nodes(nbunch_iter(component)). nbunch_iter is
        # a generator, so set(component) would incorrectly use set-copy layout.
        selected = set(n for n in component if n in index)
        nodes = selected if 2 * len(selected) < count else (n for n in ids if n in selected)
        reported = {}
        for node in nodes:
            i = index[node]
            for arc in range(ptr[i], ptr[i + 1]):
                neighbor = ids[nbr[arc]]
                if neighbor in selected and neighbor not in reported:
                    yield length[ned[arc]]
            reported[node] = 1

    # Use the runtime's sum implementation, including its float compensation,
    # exactly as canonical does rather than repeatedly accumulating with +=.
    lengths = [sum(component_lengths(c)) for c in raw]
    order = sorted(range(len(raw)), key=lambda i: -lengths[i])
    comp = {n: i for i, j in enumerate(order) for n in raw[j]}
    return comp, [lengths[j] / 1000 for j in order]
