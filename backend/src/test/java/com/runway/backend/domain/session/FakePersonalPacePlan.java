package com.runway.backend.domain.session;

import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;

public class FakePersonalPacePlan implements PersonalPacePlanPort {
    final JdbcTemplate jdbc;
    final AtomicInteger calls = new AtomicInteger();
    volatile BiFunction<Long, SessionGoal, Optional<Result>> answer;

    public FakePersonalPacePlan(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    void reset() {
        calls.set(0);
        answer = null;
    }

    public Optional<Result> plan(Long userId, SessionGoal goal) {
        if (TransactionSynchronizationManager.isActualTransactionActive())
            throw new AssertionError("AI called in transaction");
        calls.incrementAndGet();
        if (answer != null) return answer.apply(userId, goal);
        if (goal.paceSecPerKm() != null || goal.durationSec() != null) return Optional.empty();
        BigDecimal distance =
                goal.distanceM() != null
                        ? BigDecimal.valueOf(goal.distanceM())
                        : jdbc.queryForObject(
                                "SELECT distance FROM courses WHERE id=?",
                                BigDecimal.class,
                                goal.courseId());
        var segments = new ArrayList<Segment>();
        for (BigDecimal start = BigDecimal.ZERO;
                start.compareTo(distance) < 0;
                start = start.add(BigDecimal.valueOf(1000)))
            segments.add(
                    new Segment(
                            segments.size() + 1,
                            start,
                            distance.min(start.add(BigDecimal.valueOf(1000))),
                            BigDecimal.valueOf(360),
                            BigDecimal.ONE));
        return Optional.of(
                new Result(goal.courseId(), userId, distance, BigDecimal.valueOf(360), segments));
    }

    public Optional<Result> populationPlan(SessionGoal goal, BigDecimal average, String profile) {
        return plan(null, goal);
    }

    @TestConfiguration
    public static class Config {
        @Bean
        @Primary
        FakePersonalPacePlan fakePersonalPacePlan(JdbcTemplate jdbc) {
            return new FakePersonalPacePlan(jdbc);
        }
    }
}
