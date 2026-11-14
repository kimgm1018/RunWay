-- S15P31E105-815 (ADR-0025). 앱 밖 푸시(FCM)용 기기 토큰.
-- 앱이 로그인 후 FCM 등록 토큰을 N03으로 등록하고 로그아웃 전 N04로 해제한다. 알림함 행이 생기면 커밋 후 수신자의 토큰들로 발송한다.
-- 한 토큰은 한 기기를 가리키므로 전역 UNIQUE다. 같은 기기에서 다른 계정으로 로그인하면 소유자를 옮긴다.
-- 발송 실패로 UNREGISTERED 등 무효가 확인된 토큰과 탈퇴 회원의 토큰은 삭제한다(회원 행은 탈퇴 후에도 남으므로 CASCADE에 기대지 않는다).
CREATE TABLE "push_device_tokens" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "user_id" BIGINT NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updated_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_PUSH_DEVICE_TOKENS" PRIMARY KEY ("id"),
    CONSTRAINT "uq_push_device_tokens_token" UNIQUE ("token"),
    CONSTRAINT "ck_push_device_tokens_platform" CHECK ("platform" IN ('ANDROID')),
    CONSTRAINT "FK_users_TO_push_device_tokens_1"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

COMMENT ON TABLE "push_device_tokens" IS '앱 밖 푸시(FCM) 기기 등록 토큰. 알림함 행이 생기면 커밋 후 수신자의 토큰들로 발송한다(ADR-0025)';
COMMENT ON COLUMN "push_device_tokens"."user_id" IS '토큰을 등록한 회원 ID. 같은 토큰을 다른 회원이 등록하면 그 회원으로 바뀐다';
COMMENT ON COLUMN "push_device_tokens"."token" IS 'FCM 등록 토큰(앱 getToken 값). 전역 UNIQUE. 로그에는 앞 8자만 남긴다';
COMMENT ON COLUMN "push_device_tokens"."platform" IS '기기 플랫폼. 현재 ANDROID만 허용(iOS APNs 제외)';
COMMENT ON COLUMN "push_device_tokens"."created_at" IS '최초 등록일시';
COMMENT ON COLUMN "push_device_tokens"."updated_at" IS '마지막 등록(재등록) 일시. 회원당 10개 상한 정리 기준';

-- 발송 시 수신자 토큰 조회와 사용자당 상한(오래된 것부터 정리)에 쓴다.
CREATE INDEX "idx_push_device_tokens_user_updated" ON "push_device_tokens" ("user_id", "updated_at");

CREATE TRIGGER "trg_push_device_tokens_updated_at"
    BEFORE UPDATE ON "push_device_tokens"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 탈퇴(V17)와 같은 쓰기 차단. 탈퇴(진행) 회원의 새 토큰 등록·소유자 이전을 거절한다.
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "push_device_tokens"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('user', 'user_id');

-- 알림 행의 발송 상태는 이제 앱 밖 푸시 결과를 뜻한다(ADR-0025). 기존 행 값은 바꾸지 않는다.
COMMENT ON COLUMN "notifications"."delivery_status" IS
    '앱 밖 푸시 결과. PENDING=미발송(토큰 없음·푸시 꺼짐·발송 전), SENT=1개 이상 기기 전송 성공, FAILED=모든 기기 전송 실패. V42 이전 행은 앱 내 저장 의미의 SENT';
COMMENT ON COLUMN "notifications"."sent_at" IS '푸시가 1개 이상 기기에 처음 전송된 시각. 미발송이면 NULL';
