package com.runway.backend.domain.session.service;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 기동 시 이전 실행에서 PROCESSING으로 남은 종료 후 분석을 FAILED로 바꾼다. 자동으로 다시 분석하지 않는다. 복구 실패가 서버 기동을 막지 않도록 오류는
 * 로그만 남긴다.
 */
@Component
@RequiredArgsConstructor
public class PostRunAnalysisRecovery implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PostRunAnalysisRecovery.class);

    private final PostRunAnalysisService analysisService;

    @Override
    public void run(ApplicationArguments args) {
        try {
            int failed = analysisService.failInterruptedAnalyses();
            if (failed > 0) {
                log.warn("기동 시 중단된 종료 후 분석 {}건을 FAILED로 표시", failed);
            }
        } catch (RuntimeException e) {
            log.error("중단된 종료 후 분석 복구 실패 ({})", e.getClass().getSimpleName());
        }
    }
}
