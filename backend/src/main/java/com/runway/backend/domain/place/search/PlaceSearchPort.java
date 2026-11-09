package com.runway.backend.domain.place.search;

import com.runway.backend.global.geo.GeoJsonPoint;
import java.util.List;

public interface PlaceSearchPort {
    List<Place> search(String query, GeoJsonPoint reference);

    record Place(String name, String address, GeoJsonPoint position) {}
}
