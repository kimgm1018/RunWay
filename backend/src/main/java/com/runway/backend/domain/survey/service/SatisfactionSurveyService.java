package com.runway.backend.domain.survey.service;

import com.runway.backend.domain.survey.dto.request.SubmitSatisfactionSurveyRequest;
import com.runway.backend.domain.survey.dto.response.SatisfactionSurveyResponse;
import com.runway.backend.domain.survey.repository.SatisfactionSurveyRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** SV01 만족도 응답 저장. 같은 회원의 여러 번 제출을 허용하며 중복 판정을 하지 않는다. */
@Service
@RequiredArgsConstructor
public class SatisfactionSurveyService {

    private final SatisfactionSurveyRepository repository;

    @Transactional
    public SatisfactionSurveyResponse submit(long userId, SubmitSatisfactionSurveyRequest request) {
        return repository.insert(userId, request.score(), request.comment(), request.source());
    }
}
