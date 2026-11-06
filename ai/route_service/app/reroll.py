"""재추천("다른 코스 더 보기")에서 이미 보여 준 코스를 빼기 위한 짧은 코스 결과 cache (S15P31E105-383).

계약은 바뀌지 않는다: 재추천은 같은 조건 + seed만 바뀌어 온다(next_seed = seed + 24). 그래서 seed로 이전 응답을 찾는다.
  seed s 요청이 되돌아보는 묶음 수 depth = min(LOOKBACK, (s - 1) // 24)  (seed 1~24는 0 = 예전과 완전히 같음)
  depth 1: s-24 응답의 TOP3를 뺀다. depth 2: s-24와 s-48 응답의 TOP3를 뺀다. 리롤 상한(2회)은 FE/BE가 지킨다.
  "응답의 TOP3"는 그 요청이 실제로 받은 결과다. 즉 s-24 응답도 자기 depth(= depth-1)로 제외를 거친 결과다.
  s > 72(상한을 넘은 재추천)는 s-48 묶음을 첫 요청으로 보고 계산한다(현재 요청까지 최대 3번 계산).
  모두 제외된 묶음은 제외 없이 재계산하지 않고 빈 TOP3를 저장한다. 이후 되돌아볼 때도 빈 묶음으로 쓴다.

cache: key = (정규화한 요청 조건, seed, depth), value = 그 응답 TOP3의 edge id 배열(int32)뿐. 전체 응답·좌표·고도는 없다.
  TTL 10분(한 검색 안에서 재추천하는 시간), 최대 ROUTE_REROLL_CACHE_SIZE개(기본 256, 넘으면 가장 오래 안 쓴 것부터 버림).
  응답을 실제로 보낸 요청만 넣는다. 도로망 graph·mask LRU(RUNWAY_GRAPH_CACHE_SIZE, RUNWAY_MASK_CACHE_SIZE)와는 별개다.
  miss(만료·재시작·밀려남)면 이전 묶음을 같은 규칙으로 다시 계산한다. 계산은 결정적이라 hit든 miss든 응답은 같다.
"""
import sys
import threading
import time
from collections import OrderedDict

import numpy as np

LOOKBACK = 2          # 되돌아보는 이전 응답 수(= 리롤 상한 2회)
TTL_S = 600.0         # 10분
DEFAULT_SIZE = 256


def depth(seed: int, attempts: int) -> int:
    """seed가 되돌아볼 이전 묶음 수. seed 1~attempts는 0."""
    return min(LOOKBACK, (seed - 1) // attempts)


def condition_key(req, target_m: int) -> tuple:
    """엔진 입력을 정하는 조건만(좌표는 받은 float 그대로; 같은 조건으로 다시 보내면 같은 key)."""
    p2p = req.shape == "point_to_point"
    f = req.filters.model_dump()
    return (float(req.lat), float(req.lon), int(target_m), req.shape,
            float(req.end_lat) if p2p else None, float(req.end_lon) if p2p else None,
            tuple(sorted(k for k, v in f.items() if v)))


def pack(routes) -> tuple:
    """TOP3 경로 -> edge id 배열(int32 복사본: 원래 배열의 view로 큰 배열을 붙잡지 않게) tuple."""
    return tuple(np.array(r["eids"], dtype=np.int32) for r in routes)


class ShownCache:
    """TTL + LRU. thread-safe(서비스는 pipeline.lock 안에서만 쓰지만 통계 읽기는 밖에서도 한다)."""

    def __init__(self, size: int = DEFAULT_SIZE, ttl_s: float = TTL_S, clock=time.monotonic):
        self.size, self.ttl_s, self.clock = size, ttl_s, clock
        self._d: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self.hits = self.misses = self.puts = 0

    def get(self, key):
        now = self.clock()
        with self._lock:
            item = self._d.get(key)
            if item is None or now - item[0] > self.ttl_s:
                if item is not None:
                    del self._d[key]
                self.misses += 1
                return None
            self._d.move_to_end(key)
            self.hits += 1
            return item[1]

    def put(self, key, value: tuple) -> None:
        if self.size <= 0:
            return
        now = self.clock()
        with self._lock:
            self._d[key] = (now, value)
            self._d.move_to_end(key)
            self.puts += 1
            while len(self._d) > self.size:
                self._d.popitem(last=False)

    def __len__(self) -> int:
        return len(self._d)

    def nbytes(self) -> int:
        """cache가 잡은 메모리 대략값(측정 보고용): dict + key(조건 tuple 포함) + value tuple + 배열(데이터 포함)."""
        with self._lock:
            total = sys.getsizeof(self._d)
            for k, (t, v) in self._d.items():
                total += sys.getsizeof(k) + sys.getsizeof(k[0]) + sum(sys.getsizeof(x) for x in k[0])
                total += sum(sys.getsizeof(x) for x in k[1:]) + sys.getsizeof((t, v)) + sys.getsizeof(t)
                total += sys.getsizeof(v) + sum(sys.getsizeof(a) for a in v)
            return total

    def stats(self) -> dict:
        return {"entries": len(self._d), "hits": self.hits, "misses": self.misses, "puts": self.puts,
                "approx_bytes": self.nbytes()}
