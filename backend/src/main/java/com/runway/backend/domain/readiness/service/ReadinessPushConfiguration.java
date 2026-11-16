package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 준비도 정기 푸시(S15P31E105-847) 등록. {@code runway.readiness.push-enabled=false}이면 08:00 작업을 등록하지 않는다(테스트는 끄고 직접
 * 호출한다). 08:00 이후 이벤트 평가에서의 발송은 이 속성과 관계없다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = "runway.readiness.push-enabled",
        havingValue = "true",
        matchIfMissing = true)
@EnableScheduling
class ReadinessPushConfiguration {

    @Bean
    ReadinessPushJob readinessPushJob(
            ReadinessJdbcRepository repository,
            ReadinessEvaluationService evaluationService,
            ReadinessPushNotifier notifier) {
        return new ReadinessPushJob(repository, evaluationService, notifier);
    }
}
