CREATE TABLE follow_request_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id BIGINT NOT NULL UNIQUE,
    requester_id BIGINT NOT NULL REFERENCES users(id),
    target_id BIGINT NOT NULL REFERENCES users(id),
    result VARCHAR(16) NOT NULL CHECK (result IN ('APPROVED','REJECTED','CANCELLED')),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (requester_id <> target_id)
);

COMMENT ON TABLE follow_request_history IS 'U25 재전송 판별용 처리 이력. 자동 삭제하지 않으며 현재 관계의 집계·인가에는 사용하지 않는다. request_id는 삭제될 수 있는 user_follows.id이므로 해당 행 FK를 두지 않는다.';
