package com.runway.backend.domain.runningrecord.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * H08 기록 공유 링크 발급 요청. title은 앞뒤 공백을 제거한 뒤 1~40자(코드 포인트)다. 검증 전에 제거하므로 저장·검증 모두 제거한 값을 쓴다.
 *
 * <p>닉네임 검사(UserProfileValidator·SignupValidator)처럼 제어 문자(Cc, NUL 포함)와 짝이 맞지 않는 서로게이트(Cs)를 거절하고, 웹
 * 페이지·공유 시트에 그대로 보이는 값이므로 보이지 않는 서식 문자(Cf: 폭 없는 공백, 양방향 재정렬 등)도 거절한다. 글자 수는 닉네임과 같이
 * 코드 포인트로 세며 DB VARCHAR(40)과 같다.
 */
public record RunShareLinkRequest(
        @NotBlank @Pattern(regexp = "[^\\p{Cc}\\p{Cf}\\p{Cs}]{1,40}") String title) {

    public RunShareLinkRequest {
        title = title == null ? null : title.strip();
    }
}
