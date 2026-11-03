package com.runway.backend.domain.device.controller;

import com.runway.backend.domain.device.dto.request.ConsentChangeRequest;
import com.runway.backend.domain.device.dto.response.ConsentResponse;
import com.runway.backend.domain.device.dto.response.ConsentStatusResponse;
import com.runway.backend.domain.device.service.ConsentService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** W04 건강정보 동의·철회, W05 동의 상태 조회. 앱·OS 권한과 별개인 서버 동의 값이다. */
@RestController
@RequestMapping("/api/v1/consents")
@RequiredArgsConstructor
public class ConsentController {

    private final ConsentService consentService;

    /** 원문으로 받아 형식을 검증한다(중복 키 거절). 잘못된 요청은 트랜잭션·잠금 전에 끝난다. */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ConsentResponse change(
            @AuthenticationPrincipal AuthenticatedUser user,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    ConsentChangeRequest.class)))
                    @RequestBody
                    String body) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        boolean granted =
                ConsentService.requireHealthConsent(ConsentChangeRequest.parse(body));
        return consentService.change(userId, granted);
    }

    @GetMapping
    public ConsentStatusResponse status(@AuthenticationPrincipal AuthenticatedUser user) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return consentService.status(userId);
    }
}
