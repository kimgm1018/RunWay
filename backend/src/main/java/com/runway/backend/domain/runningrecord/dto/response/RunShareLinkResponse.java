package com.runway.backend.domain.runningrecord.dto.response;

/** H08 응답. url은 공개 주소 + {@code /r/{token}}이다. */
public record RunShareLinkResponse(String token, String url) {}
