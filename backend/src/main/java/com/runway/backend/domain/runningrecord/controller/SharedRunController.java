package com.runway.backend.domain.runningrecord.controller;

import com.runway.backend.domain.runningrecord.dto.response.SharedRunResponse;
import com.runway.backend.domain.runningrecord.service.RunShareLinkService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** H09 공유 기록 조회. 로그인 없이 GET/HEAD만 허용한다(SecurityConfig). */
@RestController
@RequestMapping("/api/v1/shared-runs")
@RequiredArgsConstructor
public class SharedRunController {

    private final RunShareLinkService runShareLinkService;

    @GetMapping("/{token}")
    public SharedRunResponse read(@PathVariable String token) {
        return runShareLinkService.read(token);
    }
}
