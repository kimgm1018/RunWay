package com.runway.backend.domain.community.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonSetter;
import jakarta.validation.constraints.Size;

/**
 * CMT04 수정 요청. 생략한 필드는 기존 값을 유지한다. {@code body: null}은 본문을 비운다. courseShared는 세션에 코스가 없으면
 * 값과 무관하게 false로 저장한다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class UpdatePostRequest {

    /** CMT01과 같은 500자 상한(S15P31E105-779). */
    @Size(max = 500)
    private String body;
    private boolean bodyPresent;

    private Boolean courseShared;

    @JsonSetter("body")
    public void setBody(String body) {
        this.bodyPresent = true;
        this.body = body;
    }

    @JsonSetter("courseShared")
    public void setCourseShared(Boolean courseShared) {
        this.courseShared = courseShared;
    }

    public boolean bodyPresent() {
        return bodyPresent;
    }

    public String body() {
        return body;
    }

    /** 생략 또는 null이면 기존 값 유지. */
    public Boolean courseShared() {
        return courseShared;
    }
}
