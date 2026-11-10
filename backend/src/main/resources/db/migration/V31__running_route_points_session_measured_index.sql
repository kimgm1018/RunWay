-- S15P31E105-549 (V31): S11 러닝 경로 조회와 개인화 변환기가 세션별 GPS 위치를 measured_at, id 순으로 읽는다.
-- running_route_points에는 세션 인덱스가 없어 조회마다 테이블 전체를 읽었고, 정상 워치 러닝에서 워치·폰 위치를 함께
-- 저장하면서 행 수가 늘어난다. WHERE running_session_id = ? ORDER BY measured_at, id와 같은 순서로 둔다.
-- 테이블 구조와 데이터는 바뀌지 않는다.
CREATE INDEX idx_running_route_points_session_measured
    ON running_route_points (running_session_id, measured_at, id);
