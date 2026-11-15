package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 준비도 정기 평가(S15P31E105-836) 등록. {@code runway.readiness.daily-evaluation-enabled=false}이면 작업을 등록하지 않는다(테스트는 끄고
 * 직접 호출한다). 스케줄 활성화는 이미지 정리 설정과 별개로 여기서도 선언한다. 두 곳에 선언돼도 Spring은 한 번만 등록한다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = "runway.readiness.daily-evaluation-enabled",
        havingValue = "true",
        matchIfMissing = true)
@EnableScheduling
class ReadinessDailyEvaluationConfiguration {

    @Bean
    ReadinessDailyEvaluationJob readinessDailyEvaluationJob(
            ReadinessJdbcRepository repository, ReadinessEvaluationService evaluationService) {
        return new ReadinessDailyEvaluationJob(repository, evaluationService);
    }
}
