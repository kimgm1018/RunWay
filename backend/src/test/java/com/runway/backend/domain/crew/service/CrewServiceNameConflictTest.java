package com.runway.backend.domain.crew.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.crew.dto.request.CreateCrewRequest;
import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.repository.CrewMembershipRepository;
import com.runway.backend.domain.crew.repository.CrewRepository;
import com.runway.backend.domain.crew.repository.RegionExistsRepository;
import com.runway.backend.domain.crew.repository.UserExistsRepository;
import com.runway.backend.domain.image.ImageService;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import jakarta.persistence.EntityManager;
import java.sql.SQLException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * S15P31E105-829 AC-7. M03의 저장 중 무결성 위반은 {@code uq_crews_active_name} 인덱스 위반일 때만 409로 바꾸고, 그 밖의 위반은 그대로
 * 전파한다(전역 처리기에서 500). 실제 DB에서는 crews에 다른 UNIQUE가 없어 만들 수 없으므로 PostgreSQL 서버 오류 객체를 직접 만들어 넣는다.
 */
class CrewServiceNameConflictTest {
    private CrewRepository crews;
    private CrewMembershipRepository memberships;
    private CrewService service;

    @BeforeEach
    void setUp() {
        crews = mock(CrewRepository.class);
        memberships = mock(CrewMembershipRepository.class);
        UserExistsRepository users = mock(UserExistsRepository.class);
        when(users.existsById(1L)).thenReturn(true);
        service =
                new CrewService(
                        crews,
                        memberships,
                        users,
                        mock(RegionExistsRepository.class),
                        mock(EntityManager.class),
                        mock(ImageService.class),
                        mock(NotificationService.class));
    }

    private static CreateCrewRequest request() {
        return new CreateCrewRequest(
                " 이름 ", null, null, null, 10, null, null, null, null, null);
    }

    @Test
    void 이_인덱스_위반만_409로_바꾼다() throws Exception {
        when(crews.save(any(Crew.class)))
                .thenThrow(
                        new DataIntegrityViolationException(
                                "duplicate", postgres("23505", "uq_crews_active_name")));

        assertThatThrownBy(() -> service.create(1L, request()))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> {
                            assertThat(e.code()).isEqualTo("CREW_NAME_DUPLICATED");
                            assertThat(e.status().value()).isEqualTo(409);
                        });
        verify(memberships, never()).save(any());
    }

    @Test
    void 다른_무결성_오류는_그대로_전파한다() throws Exception {
        DataIntegrityViolationException otherUnique =
                new DataIntegrityViolationException(
                        "other", postgres("23505", "FK_users_TO_crews_1"));
        DataIntegrityViolationException foreignKey =
                new DataIntegrityViolationException(
                        "fk", postgres("23503", "crews_owner_id_fkey"));
        // 23503이면 constraint 이름이 같아도 이 인덱스가 아니다.
        DataIntegrityViolationException sameNameButNotUnique =
                new DataIntegrityViolationException(
                        "fk", postgres("23503", "uq_crews_active_name"));

        for (DataIntegrityViolationException thrown :
                new DataIntegrityViolationException[] {otherUnique, foreignKey, sameNameButNotUnique}) {
            // doThrow: 이미 예외를 던지도록 스텁된 save를 when(...) 안에서 다시 호출하지 않는다.
            doThrow(thrown).when(crews).save(any(Crew.class));
            assertThatThrownBy(() -> service.create(1L, request())).isSameAs(thrown);
        }
    }

    @Test
    void constraint_이름이_없으면_그대로_전파한다() {
        DataIntegrityViolationException noCause = new DataIntegrityViolationException("none");
        DataIntegrityViolationException plainSql =
                new DataIntegrityViolationException("sql", new SQLException("x", "23505"));

        for (DataIntegrityViolationException thrown :
                new DataIntegrityViolationException[] {noCause, plainSql}) {
            doThrow(thrown).when(crews).save(any(Crew.class));
            assertThatThrownBy(() -> service.create(1L, request())).isSameAs(thrown);
        }
    }

    @Test
    void 사전_조회에_걸리면_저장하지_않고_409이다() {
        when(crews.existsActiveByNormalizedName("이름")).thenReturn(true);

        assertThatThrownBy(() -> service.create(1L, request()))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.code()).isEqualTo("CREW_NAME_DUPLICATED"));
        verify(crews, never()).save(any());
        verify(memberships, never()).save(any());
    }

    /** PostgreSQL 드라이버는 테스트 컴파일 경로에 없어 리플렉션으로 서버 오류(SQLState·constraint 이름)를 만든다. */
    private static SQLException postgres(String sqlState, String constraint) throws Exception {
        Class<?> messageClass = Class.forName("org.postgresql.util.ServerErrorMessage");
        Object message =
                messageClass
                        .getConstructor(String.class)
                        .newInstance("C" + sqlState + "\0n" + constraint + "\0");
        return (SQLException)
                Class.forName("org.postgresql.util.PSQLException")
                        .getConstructor(messageClass, boolean.class)
                        .newInstance(message, true);
    }
}
