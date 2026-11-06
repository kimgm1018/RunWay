package com.runway.backend.domain.user.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.runway.backend.domain.community.dto.response.PostListItemResponse;
import com.runway.backend.domain.community.repository.AccountVisibilityRepository;
import com.runway.backend.domain.community.service.PostService;
import com.runway.backend.domain.image.ImageService;
import com.runway.backend.domain.user.repository.FollowRepository;
import com.runway.backend.domain.user.repository.UserAccountRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunnerProfileService {
    private final UserAccountRepository accounts;
    private final AccountVisibilityRepository visibility;
    private final FollowRepository follows;
    private final PostService posts;
    private final JdbcTemplate jdbc;

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Profile(long userId, String nickname,
            @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl,
            boolean profileAccessible, String followStatus,
            @JsonInclude(JsonInclude.Include.ALWAYS) Boolean isFollowing,
            String runningLevel, Long followerCount, Long followingCount,
            List<PostListItemResponse> posts) {}

    // Access decision and payload share a snapshot even if follows are cancelled mid-read.
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Profile read(long viewer, long target) {
        var actor = accounts.findById(viewer)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        if (!"ACTIVE".equals(actor.status())) throw new ApiException(ErrorCode.UNAUTHORIZED);
        var account = accounts.findById(target)
                .orElseThrow(() -> new ApiException(ErrorCode.FOLLOW_USER_NOT_FOUND));
        if (!"ACTIVE".equals(account.status())) throw new ApiException(ErrorCode.FOLLOW_USER_NOT_FOUND);
        var relation = follows.find(viewer, target);
        String status = relation.map(r -> r.approved() ? "FOLLOWING" : "PENDING").orElse("NONE");
        Boolean following = viewer == target ? null : status.equals("FOLLOWING");
        boolean accessible = visibility.canAccess(viewer, target);
        String level = null;
        if (accessible) {
            level = jdbc.query("SELECT running_level::text FROM user_profiles WHERE user_id=?",
                    (rs, n) -> rs.getString(1), target).stream().findFirst().orElse(null);
        }
        return new Profile(target, account.nickname(),
                ImageService.publicUrlFromKey(account.profileImageKey()), accessible, status,
                following, level, accessible ? follows.followerCount(target) : null,
                accessible ? follows.followingCount(target) : null,
                accessible ? posts.list(viewer, "ALL", target).items() : null);
    }
}
