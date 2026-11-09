package com.runway.backend.domain.place.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.place.search.PlaceSearchPort;
import com.runway.backend.domain.place.search.PlaceSearchPort.Place;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class PlaceSearchServiceTest {
    private final PlaceSearchPort port = mock(PlaceSearchPort.class);
    private final PlaceSearchService service = new PlaceSearchService(port);
    private final Place place = new Place("공원", "도로 1", GeoJsonPoint.of(129.118, 35.153));

    @Test
    void emptyQueryNeverCallsProvider() {
        assertThat(service.search("  ", null, null).items()).isEmpty();
        assertThat(service.search(null, null, null).items()).isEmpty();
        verifyNoInteractions(port);
    }

    @Test
    void deduplicatesPreservesOrderAndLeavesUnknownDistanceNull() {
        when(port.search("공원", null)).thenReturn(List.of(place, place));
        var items = service.search(" 공원 ", null, null).items();
        assertThat(items).hasSize(1);
        assertThat(items.getFirst().position()).containsExactly(129.118, 35.153);
        assertThat(items.getFirst().distanceM()).isNull();
    }

    @Test
    void calculatesStraightLineDistanceAndCapsResults() {
        var reference = place.position();
        when(port.search("공원", reference)).thenReturn(IntStream.range(0, 11)
                .mapToObj(i -> new Place("공원" + i, "도로 1", reference)).toList());
        var items = service.search("공원", 35.153, 129.118).items();
        assertThat(items).hasSize(10);
        assertThat(items.getFirst().distanceM()).isZero();
        when(port.search("공원", GeoJsonPoint.of(129.118, 35.154)))
                .thenReturn(List.of(place));
        assertThat(service.search("공원", 35.154, 129.118).items().getFirst().distanceM())
                .isBetween(110.0, 112.0);
    }

    @Test
    void rejectsLongQueryAndInvalidCoordinatesBeforeProvider() {
        assertThatThrownBy(() -> service.search("가".repeat(101), null, null))
                .isInstanceOf(ApiException.class).hasMessage("요청 값이 유효하지 않습니다.");
        for (Double[] pair : List.of(new Double[] {1.0, null}, new Double[] {null, 1.0},
                new Double[] {91.0, 0.0}, new Double[] {0.0, 181.0},
                new Double[] {Double.NaN, 0.0}, new Double[] {0.0, Double.POSITIVE_INFINITY})) {
            assertThatThrownBy(() -> service.search("공원", pair[0], pair[1]))
                    .isInstanceOf(ApiException.class);
        }
        verifyNoInteractions(port);
    }

    @Test
    void acceptsOneHundredUnicodeCodePoints() {
        String query = "🏃".repeat(100);
        when(port.search(query, null)).thenReturn(List.of());
        assertThat(service.search(query, null, null).items()).isEmpty();
        verify(port).search(query, null);
    }
}
