package com.runway.backend.domain.community.controller;

import com.runway.backend.domain.community.dto.response.SearchResponse;
import com.runway.backend.domain.community.service.SearchService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class SearchController {

    private final SearchService searchService;

    @GetMapping("/api/v1/search")
    public SearchResponse search(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return searchService.search(userId, q, type, cursor, limit);
    }
}
