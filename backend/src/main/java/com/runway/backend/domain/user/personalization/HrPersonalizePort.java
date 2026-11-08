package com.runway.backend.domain.user.personalization;

/** AI06 HR 개인화 호출 포트. 구현은 {@code infrastructure.ai}의 HTTP 클라이언트다. 예외를 던지지 않고 결과로 돌려준다. */
public interface HrPersonalizePort {

    HrPersonalizeResult personalize(Ai06PersonalizeRequest request);
}
