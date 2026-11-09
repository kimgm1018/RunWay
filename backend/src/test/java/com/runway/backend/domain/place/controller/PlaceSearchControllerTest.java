package com.runway.backend.domain.place.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.place.search.PlaceSearchPort;
import com.runway.backend.domain.place.search.PlaceSearchPort.Place;
import com.runway.backend.domain.place.service.PlaceSearchService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.exception.GlobalExceptionHandler;
import com.runway.backend.global.geo.GeoJsonPoint;
import com.runway.backend.global.security.AuthenticatedUser;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.bind.support.WebDataBinderFactory;

class PlaceSearchControllerTest {
    private final PlaceSearchPort port = mock(PlaceSearchPort.class);
    private boolean authenticated = true;
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(
                    new PlaceSearchController(new PlaceSearchService(port)))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new HandlerMethodArgumentResolver() {
                public boolean supportsParameter(MethodParameter p) {
                    return p.getParameterType() == AuthenticatedUser.class;
                }
                public Object resolveArgument(MethodParameter p, ModelAndViewContainer m,
                        NativeWebRequest r, WebDataBinderFactory b) {
                    return authenticated ? new AuthenticatedUser(1) : null;
                }
            }).build();

    @Test
    void serializesSearchContract() throws Exception {
        when(port.search("공원", null)).thenReturn(List.of(
                new Place("공원", "도로 1", GeoJsonPoint.of(129.118, 35.153))));
        mvc.perform(get("/api/v1/places/search").param("query", "공원"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].name").value("공원"))
                .andExpect(jsonPath("$.items[0].position[0]").value(129.118))
                .andExpect(jsonPath("$.items[0].position[1]").value(35.153))
                .andExpect(jsonPath("$.items[0].distanceM").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void missingIdentityNeverCallsProvider() throws Exception {
        authenticated = false;
        mvc.perform(get("/api/v1/places/search").param("query", "공원"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(port);
    }

    @Test
    void rejectsIncompleteAndMalformedCoordinates() throws Exception {
        for (String latitude : List.of("oops", "NaN", "91", "35")) {
            mvc.perform(get("/api/v1/places/search").param("query", "공원")
                            .param("latitude", latitude))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        verifyNoInteractions(port);
    }

    @Test
    void reportsUnavailableRatherThanEmptyResults() throws Exception {
        when(port.search("공원", null)).thenThrow(new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
        mvc.perform(get("/api/v1/places/search").param("query", "공원"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
    }
}
