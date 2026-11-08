package com.runway.backend.domain.image;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "runway.images.cleanup-enabled", havingValue = "true", matchIfMissing = true)
@EnableScheduling
class ImageCleanupConfiguration {}
