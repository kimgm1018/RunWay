package com.runway.backend.domain.auth.validation;

public final class PasswordPolicy {
    private PasswordPolicy() {}

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
}
