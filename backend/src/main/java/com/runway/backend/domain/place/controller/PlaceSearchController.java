package com.runway.backend.domain.place.controller;

import com.runway.backend.domain.place.dto.response.PlaceSearchResponse;
import com.runway.backend.domain.place.service.PlaceSearchService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/places/search")
public class PlaceSearchController {
    private final PlaceSearchService placeSearchService;

    public PlaceSearchController(PlaceSearchService placeSearchService) {
        this.placeSearchService = placeSearchService;
    }

    @GetMapping
    public PlaceSearchResponse search(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(defaultValue = "") String query,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude) {
        CurrentUserIdResolver.requireUserId(user);
        return placeSearchService.search(query, latitude, longitude);
    }
}
