package com.runway.backend.domain.auth.validation;

public final class PasswordPolicy {
    private PasswordPolicy() {}

    /** 로그인·탈퇴 등 기존 비밀번호 입력의 형식: 8~20 코드포인트, 공백·고립 surrogate 불가(users.md). */
    public static boolean accepts(Object value) {
        if (!(value instanceof String text) || text.length() > 40) return false;
        int count = 0;
        for (int offset = 0; offset < text.length(); ) {
            char first = text.charAt(offset);
            if (Character.isSurrogate(first)
                    && (!Character.isHighSurrogate(first)
                            || offset + 1 >= text.length()
                            || !Character.isLowSurrogate(text.charAt(offset + 1)))) return false;
            int point = text.codePointAt(offset);
            if (Character.isWhitespace(point) || Character.isSpaceChar(point)) return false;
            count++;
            offset += Character.charCount(point);
        }
        return count >= 8 && count <= 20;
    }

    /**
     * U15 가입·U30 재설정에서 새로 정하는 비밀번호(users.md, S15P31E105-773): {@link #accepts} 형식에 더해 영문·숫자·키보드
     * 특수문자(ASCII 0x21~0x7E)만 쓴다.
     */
    public static boolean acceptsNew(Object value) {
        if (!accepts(value)) return false;
        for (char c : ((String) value).toCharArray()) {
            if (c < 0x21 || c > 0x7E) return false;
        }
        return true;
    }

    /** 아이디와 같은 비밀번호(대소문자 무시, S15P31E105-773). 아이디는 영문·숫자라 ASCII 비교로 충분하다. */
    public static boolean sameAsLoginId(String password, String loginId) {
        return password != null && loginId != null && password.equalsIgnoreCase(loginId);
    }
}
