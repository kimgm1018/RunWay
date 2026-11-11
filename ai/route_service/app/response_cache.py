"""추천 성공 응답 전체를 짧게 저장하는 cache (S15P31E105-630).

왜: BE는 15초 안에 답을 못 받으면 포기하지만 Route는 시작한 계산을 끝까지 하고, 그 결과는 버려졌다. 사용자가 "다시 시도"를
누르거나 같은 조건으로 다시 요청하면 엔진 lock을 다시 기다려 처음부터 계산했다. 같은 입력 + 같은 데이터 = 같은 결과(결정적)이므로
끝난 계산의 성공 응답 byte를 그대로 저장했다가 같은 요청에 돌려준다.

key = 응답을 바꿀 수 있는 값 전부의 sha256:
  요청 본문 전체(RecommendRequest: lat, lon, distance_km, filters, seed, shape, end_lat, end_lon; 받은 값 그대로)
  + 서비스 설정(data_mode, national_dir, gate_mode, fast_graph, reroll_exclude, debug).
  X-Request-Deadline 헤더·요청 시각은 넣지 않는다(응답을 바꾸지 않음). 데이터·엔진 스위치는 프로세스 시작 때 한 번 정해지고
  cache는 프로세스 메모리에만 있으므로 재시작하면 비워진다(데이터가 바뀌면 재시작이 필요하다).
재추천(seed >= 25): 응답은 (조건, seed)로 정해진다. 뺄 이전 TOP3는 재추천 cache(app/reroll.py)에서 찾고, 없으면 같은 규칙으로
  다시 계산하므로 hit/miss와 관계없이 같다. 그래서 seed가 key에 있으면 충분하고 재추천도 저장한다. hit 때는 그 응답의
  TOP3 edge 묶음을 재추천 cache에 다시 넣어, 다음 재추천이 이전 묶음을 다시 계산하지 않게 한다.
저장 조건: 계산이 끝난 200 응답만. BE가 이미 포기했거나 마감이 지났어도 계산이 끝났으면 저장한다. 오류 응답은 저장하지 않는다.
  ROUTE_DEBUG=1 응답은 저장하지 않는다(generation.seconds 같은 측정값과 재추천 cache 통계가 들어 있어 매번 다르다).
크기: 최대 ROUTE_RESPONSE_CACHE_SIZE개(기본 32, 응답 1개 보통 수십 KB, 최대 약 256 KB), TTL ROUTE_RESPONSE_CACHE_TTL_S(기본 600초).
  넘으면 가장 오래 안 쓴 것부터 버린다. thread-safe(엔진 lock 밖에서 읽는다).
"""
import hashlib
import json
import threading
import time
from collections import OrderedDict

DEFAULT_SIZE = 32
DEFAULT_TTL_S = 600.0


def request_key(req, settings) -> str:
    """응답을 정하는 값만으로 만든 key(sha256 hex). 로그에는 앞 12자리만 남긴다(좌표를 남기지 않음)."""
    payload = {
        "request": req.model_dump(mode="json"),
        "settings": {"data_mode": settings.data_mode,
                     "national_dir": str(settings.national_dir) if settings.national_dir else None,
                     "gate_mode": settings.gate_mode, "fast_graph": settings.fast_graph,
                     "reroll_exclude": settings.reroll_exclude, "debug": settings.debug},
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(raw.encode("ascii")).hexdigest()


class ResponseCache:
    """TTL + LRU. value = (응답 body bytes, 재추천 cache에 다시 넣을 (key, value) 또는 None)."""

    def __init__(self, size: int = DEFAULT_SIZE, ttl_s: float = DEFAULT_TTL_S, clock=time.monotonic):
        self.size, self.ttl_s, self.clock = size, ttl_s, clock
        self._d: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self.hits = self.misses = self.puts = 0

    def get(self, key: str, *, count_miss: bool = True):
        now = self.clock()
        with self._lock:
            item = self._d.get(key)
            if item is None or now - item[0] > self.ttl_s:
                if item is not None:
                    del self._d[key]
                if count_miss:
                    self.misses += 1
                return None
            self._d.move_to_end(key)
            self.hits += 1
            return item[1]

    def put(self, key: str, body: bytes, reroll_item=None) -> None:
        if self.size <= 0:
            return
        now = self.clock()
        with self._lock:
            self._d[key] = (now, (body, reroll_item))
            self._d.move_to_end(key)
            self.puts += 1
            while len(self._d) > self.size:
                self._d.popitem(last=False)

    def __len__(self) -> int:
        return len(self._d)

    def stats(self) -> dict:
        with self._lock:
            return {"entries": len(self._d), "hits": self.hits, "misses": self.misses, "puts": self.puts,
                    "bytes": sum(len(v[1][0]) for v in self._d.values())}
