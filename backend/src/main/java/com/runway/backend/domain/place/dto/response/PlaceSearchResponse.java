package com.runway.backend.domain.place.dto.response;

import java.util.List;

public record PlaceSearchResponse(List<Item> items) {
    public record Item(String name, String address, List<Double> position, Double distanceM) {}
}
