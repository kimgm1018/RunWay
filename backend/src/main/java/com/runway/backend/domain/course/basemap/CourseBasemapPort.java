package com.runway.backend.domain.course.basemap;

import java.time.Instant;
import java.util.List;

/**
 * 코스 썸네일 바탕 지도(OSM 지형지물·건물)를 가져오는 Route 내부 API 포트({@code POST /internal/v1/basemaps}, {@code detail
 * "full"}, S15P31E105-612).
 *
 * <p>호출은 호출 스레드를 막는 원격 요청이므로 트랜잭션 밖에서만 부른다. 예외를 던지지 않고 결과 형식으로 돌려준다.
 */
public interface CourseBasemapPort {

    /** Route 주소가 설정되어 호출할 수 있는지. false면 생성·일괄 채우기를 하지 않는다. */
    boolean isConfigured();

    /**
     * Route 준비 상태({@code GET /internal/v1/ready}). 200이고 본문 {@code ready}가 true일 때만 true다. 연결 실패·시간 초과·그 밖의
     * 응답은 모두 false이며 예외를 던지지 않는다. 주소가 없으면 호출하지 않고 false다.
     */
    boolean isReady();

    /**
     * @param courseId 로그용 코스 ID. Route에는 보내지 않는다
     * @param bbox 요청 범위. Route에는 경로가 아닌 이 범위만 보낸다
     * @param metersPerPixel 썸네일 축척(화면 1px의 지면 m). Route가 화면에서 보이지 않는 등급·건물을 빼는 데 쓴다(선택 필드)
     */
    BasemapResult fetch(long courseId, BasemapBbox bbox, double metersPerPixel);

    /** Route 호출 결과. */
    sealed interface BasemapResult {}

    /**
     * 정상 응답.
     *
     * @param features 검증을 통과한 지형지물
     * @param osmDataTimestamp OSM 데이터 기준 시각. 없거나 해석할 수 없으면 null
     * @param buildingsAvailable Route가 건물 자료를 갖고 있는지
     * @param buildingsOsmDataTimestamp 건물 자료의 OSM 기준 시각. 없거나 해석할 수 없으면 null
     */
    record Success(
            List<BasemapFeature> features,
            Instant osmDataTimestamp,
            boolean buildingsAvailable,
            Instant buildingsOsmDataTimestamp)
            implements BasemapResult {

        public Success {
            features = List.copyOf(features);
        }
    }

    /** 범위가 전국 자료 밖(422 OUT_OF_AREA). 이미지 없는 행으로 저장해 다시 시도하지 않는다. */
    record OutOfArea() implements BasemapResult {}

    /**
     * 연결 실패·시간 초과·오류 응답·계약 위반. 저장하지 않으며 다음 기동 때 다시 시도한다.
     *
     * @param reason 로그용 사유 코드(상류 본문·좌표 없음)
     */
    record Failure(String reason) implements BasemapResult {

        /**
         * Route가 잠깐 바쁘거나 멈춘 것으로 보이는 실패(연결 실패·시간 초과·5xx, 예: 503 BUSY·NOT_READY)인지. 일괄 채우기는 이런
         * 코스를 같은 실행 안에서 한 번 더 시도한다. 계약 위반·4xx·응답 초과·설정 누락·중단은 아니다.
         */
        public boolean retryable() {
            return reason != null
                    && (reason.equals("TIMEOUT")
                            || reason.equals("UNAVAILABLE")
                            || reason.startsWith("HTTP_5"));
        }
    }
}
