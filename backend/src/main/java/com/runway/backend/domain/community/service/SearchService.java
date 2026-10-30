package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.response.SearchCrewItemResponse;
import com.runway.backend.domain.community.dto.response.SearchResponse;
import com.runway.backend.domain.community.dto.response.SearchUserItemResponse;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.UserSearchRepository;
import com.runway.backend.domain.community.repository.UserSearchRepository.UserSearchRow;
import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewStatus;
import com.runway.backend.domain.crew.repository.CrewRepository;
import com.runway.backend.global.exception.ApiException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class SearchService {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;
    private static final char LIKE_ESCAPE = '!';

    /** `0`=축 소진, `-`=미조회(처음부터), 양수=해당 id 다음부터. */
    private static final Pattern CURSOR_PATTERN =
            Pattern.compile("u:(\\d{1,18}|-)\\|c:(\\d{1,18}|-)");

    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final UserSearchRepository userSearchRepository;
    private final CrewRepository crewRepository;

    @Transactional(readOnly = true)
    public SearchResponse search(long userId, String q, String type, String cursor, Integer limit) {
        requireExistingUser(userId);

        String keyword = q == null ? "" : q.trim();
        if (keyword.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "QUERY_TOO_SHORT", "검색어가 너무 짧습니다.");
        }
        SearchType searchType = parseType(type);
        int pageSize = resolveLimit(limit);
        SearchCursor searchCursor = parseCursor(cursor);
        String escaped = escapeLike(keyword);

        List<SearchUserItemResponse> users = null;
        Axis nextUser = Axis.unqueried();
        if (searchType != SearchType.CREW) {
            if (searchCursor.user().isExhausted()) {
                users = List.of();
                nextUser = Axis.exhausted();
            } else {
                List<UserSearchRow> rows =
                        userSearchRepository.searchActiveByNickname(
                                escaped, searchCursor.user().afterId(), pageSize + 1);
                boolean hasMore = rows.size() > pageSize;
                List<UserSearchRow> pageRows = hasMore ? rows.subList(0, pageSize) : rows;
                users =
                        pageRows.stream()
                                .map(row -> new SearchUserItemResponse(row.id(), row.nickname()))
                                .toList();
                nextUser =
                        hasMore
                                ? Axis.after(pageRows.get(pageRows.size() - 1).id())
                                : Axis.exhausted();
            }
        }

        List<SearchCrewItemResponse> crews = null;
        Axis nextCrew = Axis.unqueried();
        if (searchType != SearchType.USER) {
            if (searchCursor.crew().isExhausted()) {
                crews = List.of();
                nextCrew = Axis.exhausted();
            } else {
                List<Crew> rows =
                        crewRepository.searchActiveByNameAfter(
                                CrewStatus.ACTIVE,
                                escaped,
                                searchCursor.crew().afterId(),
                                PageRequest.of(0, pageSize + 1));
                boolean hasMore = rows.size() > pageSize;
                List<Crew> pageRows = hasMore ? rows.subList(0, pageSize) : rows;
                crews =
                        pageRows.stream()
                                .map(
                                        crew ->
                                                new SearchCrewItemResponse(
                                                        crew.getId(), crew.getName()))
                                .toList();
                nextCrew =
                        hasMore
                                ? Axis.after(pageRows.get(pageRows.size() - 1).getId())
                                : Axis.exhausted();
            }
        }

        String nextPage = encodeNextPage(searchType, nextUser, nextCrew);
        return new SearchResponse(users, crews, nextPage);
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
    }

    private static SearchType parseType(String type) {
        if (type == null) {
            return SearchType.ALL;
        }
        return switch (type) {
            case "USER" -> SearchType.USER;
            case "CREW" -> SearchType.CREW;
            default ->
                    throw new ApiException(
                            HttpStatus.BAD_REQUEST,
                            "VALIDATION_ERROR",
                            "type은 USER 또는 CREW여야 합니다.");
        };
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "limit은 1 이상 " + MAX_LIMIT + " 이하여야 합니다.");
        }
        return limit;
    }

    private static SearchCursor parseCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return SearchCursor.START;
        }
        try {
            String decoded =
                    new String(
                            Base64.getUrlDecoder().decode(cursor.trim()), StandardCharsets.UTF_8);
            Matcher matcher = CURSOR_PATTERN.matcher(decoded);
            if (!matcher.matches()) {
                throw invalidCursor();
            }
            return new SearchCursor(parseAxis(matcher.group(1)), parseAxis(matcher.group(2)));
        } catch (IllegalArgumentException ex) {
            throw invalidCursor();
        }
    }

    private static Axis parseAxis(String token) {
        if ("-".equals(token)) {
            return Axis.unqueried();
        }
        long id = Long.parseLong(token);
        if (id == 0L) {
            return Axis.exhausted();
        }
        return Axis.after(id);
    }

    /**
     * typed 검색에서 미조회 축은 `-`로 남겨 ALL 등으로 type을 바꿔도 처음부터 조회할 수 있게 한다. 조회한 축만 소진(`0`) 또는 다음 id를 기록한다.
     */
    private static String encodeNextPage(SearchType type, Axis nextUser, Axis nextCrew) {
        boolean userHasMore = nextUser.hasMore();
        boolean crewHasMore = nextCrew.hasMore();
        boolean emit =
                switch (type) {
                    case ALL -> userHasMore || crewHasMore;
                    case USER -> userHasMore;
                    case CREW -> crewHasMore;
                };
        if (!emit) {
            return null;
        }
        Axis userToken =
                switch (type) {
                    case CREW -> Axis.unqueried();
                    case ALL, USER -> nextUser;
                };
        Axis crewToken =
                switch (type) {
                    case USER -> Axis.unqueried();
                    case ALL, CREW -> nextCrew;
                };
        return encodeCursor(userToken, crewToken);
    }

    private static String encodeCursor(Axis user, Axis crew) {
        String raw = "u:" + user.token() + "|c:" + crew.token();
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static String escapeLike(String keyword) {
        StringBuilder builder = new StringBuilder(keyword.length());
        for (char ch : keyword.toCharArray()) {
            if (ch == LIKE_ESCAPE || ch == '%' || ch == '_') {
                builder.append(LIKE_ESCAPE);
            }
            builder.append(ch);
        }
        return builder.toString();
    }

    private static ApiException invalidCursor() {
        return new ApiException(
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "cursor 형식이 올바르지 않습니다.");
    }

    private enum SearchType {
        ALL,
        USER,
        CREW
    }

    private record SearchCursor(Axis user, Axis crew) {
        static final SearchCursor START = new SearchCursor(Axis.unqueried(), Axis.unqueried());
    }

    private record Axis(long afterId, boolean exhaustedFlag) {

        static Axis unqueried() {
            return new Axis(0L, false);
        }

        static Axis after(long id) {
            return new Axis(id, false);
        }

        static Axis exhausted() {
            return new Axis(0L, true);
        }

        boolean isExhausted() {
            return exhaustedFlag;
        }

        boolean hasMore() {
            return !exhaustedFlag && afterId > 0L;
        }

        String token() {
            if (exhaustedFlag) {
                return "0";
            }
            if (afterId == 0L) {
                return "-";
            }
            return Long.toString(afterId);
        }
    }
}
