package com.runway.backend.global.exception;

import java.util.Set;

/**
 * 다시 시도하면 성공할 수 있는 PostgreSQL SQLState. 공통 오류 처리기와 SQLState로 직접 판별하는 저장소가 같은 기준으로 503을 응답하도록 한
 * 곳에서 관리한다.
 *
 * <p>spring-jdbc 7.0.9 기본 변환기는 57014(쿼리 취소)를 QueryTimeoutException으로, 40001·40P01을 잠금 실패로 이미 분류하지만
 * 55P03(잠금 대기 초과)은 분류하지 못하고 UncategorizedSQLException으로 남긴다. 55P03 외의 항목은 변환기 설정이 바뀌어도 같은 응답을
 * 유지하기 위한 방어 목록이다.
 */
public final class RetryableSqlStates {

    private static final Set<String> STATES = Set.of("55P03", "57014", "40001", "40P01");

    private RetryableSqlStates() {}

    public static boolean contains(String sqlState) {
        return sqlState != null && STATES.contains(sqlState);
    }
}
