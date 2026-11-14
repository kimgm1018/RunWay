package com.runway.backend.global.search;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

/**
 * 검색어(`q`) 공통 규칙(S15P31E105-820). 통합 검색(CMT13)과 크루 검색(M01)이 같은 상한과 LIKE 이스케이프를 쓴다.
 *
 * <p>앱 검색창 상한은 이 값에 맞춘다. 서버는 코드 포인트로 세므로 UTF-16 길이로 제한하는 앱 입력은 항상 이 상한 안에 든다.
 */
public final class SearchKeywords {

    /** 정규화(trim)한 검색어의 최대 길이(코드 포인트). */
    public static final int MAX_LENGTH = 50;

    /** LIKE 이스케이프 문자. 쿼리의 {@code ESCAPE '!'}와 같아야 한다. */
    public static final char LIKE_ESCAPE = '!';

    private SearchKeywords() {}

    /** 이미 trim한 검색어가 {@link #MAX_LENGTH}를 넘으면 400 VALIDATION_ERROR. */
    public static void requireWithinMaxLength(String keyword) {
        if (keyword.codePointCount(0, keyword.length()) > MAX_LENGTH) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR_SEARCH_QUERY_TOO_LONG, String.valueOf(MAX_LENGTH));
        }
    }

    /** {@code %}·{@code _}·{@code !}를 글자 그대로 찾도록 {@link #LIKE_ESCAPE}로 이스케이프한다. */
    public static String escapeLike(String keyword) {
        StringBuilder builder = new StringBuilder(keyword.length());
        for (char ch : keyword.toCharArray()) {
            if (ch == LIKE_ESCAPE || ch == '%' || ch == '_') {
                builder.append(LIKE_ESCAPE);
            }
            builder.append(ch);
        }
        return builder.toString();
    }
}
