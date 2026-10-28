package com.runway.backend.domain.course.dto.request;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.JsonNode;

/**
 * C07 북마크 요청. {@code alias} 생략·null·문자열을 구분한다.
 *
 * <ul>
 *   <li>필드 생략 → {@code aliasPresent=false} (기존 값 유지)
 *   <li>{@code "alias": null} → {@code aliasPresent=true}, {@code alias=null} (별명 제거)
 *   <li>{@code "alias": "이름"} → 해당 값으로 설정
 * </ul>
 */
public final class BookmarkCourseRequest {

    private final boolean aliasPresent;
    private final String alias;

    private BookmarkCourseRequest(boolean aliasPresent, String alias) {
        this.aliasPresent = aliasPresent;
        this.alias = alias;
    }

    public static BookmarkCourseRequest omitted() {
        return new BookmarkCourseRequest(false, null);
    }

    @JsonCreator
    public static BookmarkCourseRequest create(@JsonProperty("alias") JsonNode aliasNode) {
        if (aliasNode == null || aliasNode.isMissingNode()) {
            return new BookmarkCourseRequest(false, null);
        }
        if (aliasNode.isNull()) {
            return new BookmarkCourseRequest(true, null);
        }
        if (!aliasNode.isString()) {
            throw new IllegalArgumentException("alias must be a string or null");
        }
        return new BookmarkCourseRequest(true, aliasNode.stringValue());
    }

    public boolean aliasPresent() {
        return aliasPresent;
    }

    public String alias() {
        return alias;
    }
}
