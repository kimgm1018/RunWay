package com.runway.backend.domain.survey.controller;

import com.runway.backend.domain.survey.dto.request.SubmitSatisfactionSurveyRequest;
import com.runway.backend.domain.survey.dto.response.SatisfactionSurveyResponse;
import com.runway.backend.domain.survey.service.SatisfactionSurveyService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** SV01 서비스 만족도 응답 제출(S15P31E105-813). */
@RestController
@RequestMapping("/api/v1/satisfaction-surveys")
@RequiredArgsConstructor
public class SatisfactionSurveyController {

    private final SatisfactionSurveyService service;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SatisfactionSurveyResponse submit(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody SubmitSatisfactionSurveyRequest request) {
        return service.submit(CurrentUserIdResolver.requireUserId(user), request);
    }
}
