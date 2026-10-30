package com.runway.backend.domain.auth.controller;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;

@Component
// 아이디 확인의 호출 횟수를 어느 IP에 집계할지 결정하는 클래스
public class ClientIpResolver {
    private final List<IpAddressMatcher> trusted;

    public ClientIpResolver(@Value("${runway.auth.trusted-proxies:}") String proxies) {
        try {
            trusted =
                    Arrays.stream(proxies.split(","))
                            .map(String::trim)
                            .filter(s -> !s.isEmpty())
                            .map(IpAddressMatcher::new)
                            .toList();
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("BACKEND_AUTH_TRUSTED_PROXIES 형식 오류");
        }
    }

    public String resolve(HttpServletRequest request) {
        String peer = literal(request.getRemoteAddr());
        if (!trusted(peer)) return peer;
        var headers = java.util.Collections.list(request.getHeaders("X-Forwarded-For"));
        String forwarded = String.join(",", headers);
        if (forwarded.isBlank()) return peer;
        if (forwarded.length() > 4096)
            throw com.runway.backend.domain.auth.validation.SignupValidator.invalid(
                    "VALIDATION_ERROR");
        String[] hops = forwarded.split(",", -1);
        for (int i = hops.length - 1; i >= 0 && trusted(peer); i--) peer = literal(hops[i].trim());
        return peer;
    }

    private boolean trusted(String address) {
        return trusted.stream().anyMatch(matcher -> matcher.matches(address));
    }

    private static String literal(String address) {
        try {
            // No DNS names, ports, zones or brackets. InetAddress only parses numeric addresses.
            if (address == null
                    || address.isEmpty()
                    || !(address.contains(":")
                            ? address.matches("[0-9a-fA-F:.]+")
                            : address.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")))
                throw new UnknownHostException();
            return InetAddress.getByName(address).getHostAddress();
        } catch (UnknownHostException exception) {
            throw com.runway.backend.domain.auth.validation.SignupValidator.invalid(
                    "VALIDATION_ERROR");
        }
    }
}
