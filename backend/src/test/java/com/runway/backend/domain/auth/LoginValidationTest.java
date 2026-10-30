package com.runway.backend.domain.auth;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.controller.LoginController;
import com.runway.backend.domain.auth.service.LoginService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(LoginController.class)
@AutoConfigureMockMvc(addFilters = false)
class LoginValidationTest {
    @Autowired MockMvc mvc;
    @MockitoBean LoginService service;

    @Test
    void invalidInputsAndBoundaries() throws Exception {
        for (String body :
                new String[] {
                    "{",
                    "{}",
                    "null",
                    "[]",
                    "{\"loginId\":1234,\"password\":\"Runner9!\"}",
                    "{\"loginId\":\"runner01\",\"password\":12345678}",
                    "{\"loginId\":\"runner01\",\"password\":true}",
                    "{\"loginId\":\"abc\",\"password\":\"Runner9!\"}",
                    "{\"loginId\":\"abc!\",\"password\":\"Runner9!\"}",
                    "{\"loginId\":\"abcdefghijklmnopq\",\"password\":\"Runner9!\"}",
                    "{\"loginId\":\"runner01\",\"password\":null}",
                    "{\"loginId\":\"runner01\",\"password\":\"1234567\"}",
                    "{\"loginId\":\"runner01\",\"password\":\"123456789012345678901\"}",
                    "{\"loginId\":\"runner01\",\"password\":\"Run ner9!\"}"
                }) {
            mvc.perform(
                            post("/api/v1/auth/login")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        verifyNoInteractions(service);
        when(service.login(anyString(), anyString())).thenReturn(null);
        for (String id : new String[] {"abcd", "abcdefghijklmnop"}) {
            mvc.perform(
                            post("/api/v1/auth/login")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            "{\"loginId\":\""
                                                    + id
                                                    + "\",\"password\":\"!!!!!!!!\"}"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        verify(service).login("abcd", "!!!!!!!!");
        verify(service).login("abcdefghijklmnop", "!!!!!!!!");
    }
}
