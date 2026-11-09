-- S15P31E105-597 (V23): G10 그룹런 실시간 순위가 세션별로 허용 시각 이하의 최신 누적 거리 표본과 종류 무관 최신 측정 표본을
-- measured_at 역순으로 하나씩 고른다(조회마다 참가자 수 x 2회). 기존 V13 인덱스는 elapsed_duration 순이라 세션 표본 전체를
-- 정렬하던 조회다. ORDER BY measured_at DESC, id DESC와 같은 순서로 두어 앞쪽 몇 행만 읽게 한다.
-- 테이블 구조와 데이터는 바뀌지 않는다.
CREATE INDEX idx_running_metric_samples_session_measured
    ON running_metric_samples (running_session_id, measured_at DESC, id DESC);
