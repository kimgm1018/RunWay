package com.runway.backend.domain.auth.validation;

import java.util.regex.Pattern;

/**
 * U15 가입·U05 프로필 수정의 닉네임 규칙(users.md, S15P31E105-781): 완성형 한글(가~힣)·영문·숫자만 2~10자. 공백·이모지·특수문자·
 * 자모 단독·제어문자·고립 surrogate는 허용 문자 밖이라 함께 거절된다. 허용 문자는 모두 BMP 한 글자라 글자 수와 char 수가 같다.
 */
public final class NicknamePolicy {
    private static final Pattern ALLOWED = Pattern.compile("[가-힣A-Za-z0-9]{2,10}");

    private NicknamePolicy() {}

    public static boolean accepts(String value) {
        return value != null && ALLOWED.matcher(value).matches();
    }
}
