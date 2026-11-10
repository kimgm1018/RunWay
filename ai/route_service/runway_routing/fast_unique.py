"""np.unique(ar) (추가 반환값 없음)와 같은 값·dtype을 정렬 + 인접 비교로 만든다 (S15P31E105-621).

numpy 2.3부터 정수 배열의 np.unique는 해시 방식으로 바뀌어 수백만 개 int에서 정렬 방식보다 30–50배 느리다
(2M int64: 약 1.1–1.5초 vs 0.03–0.05초). 요청마다 이런 호출이 여러 번 있어 첫 요청이 수 초 늘어난다.
결과는 np.unique와 같다: 오름차순 정렬된 서로 다른 값, 입력과 같은 dtype. 1차원 정수·bool이 아니면 np.unique를 그대로 쓴다.
"""
import numpy as np


def sorted_unique(ar) -> np.ndarray:
    ar = np.asarray(ar)
    if ar.ndim != 1 or ar.dtype.kind not in "iub":
        return np.unique(ar)
    s = np.sort(ar)
    if len(s) == 0:
        return s
    return s[np.concatenate(([True], s[1:] != s[:-1]))]
