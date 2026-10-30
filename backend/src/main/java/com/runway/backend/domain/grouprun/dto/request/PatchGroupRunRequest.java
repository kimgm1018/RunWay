package com.runway.backend.domain.grouprun.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.time.Instant;

/**
 * G04 PATCH. 생략은 유지, {@code courseId: null}은 코스 해제. 목표 부분 null 해제는 미구현이며
 * 목표 필드가 오면 환산으로 재설정한다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class PatchGroupRunRequest {

    private String title;
    private boolean titlePresent;

    private String description;
    private boolean descriptionPresent;

    private Instant scheduledAt;
    private boolean scheduledAtPresent;

    private GeoJsonPoint meetingPosition;
    private boolean meetingPositionPresent;

    private String meetingPlaceName;
    private boolean meetingPlaceNamePresent;

    private String meetingAddress;
    private boolean meetingAddressPresent;

    private Long courseId;
    private boolean courseIdPresent;

    private Integer targetDistanceM;
    private boolean targetDistanceMPresent;

    private String goalInputType;
    private boolean goalInputTypePresent;

    private Integer targetDurationSec;
    private boolean targetDurationSecPresent;

    private Integer targetPaceSecPerKm;
    private boolean targetPaceSecPerKmPresent;

    @JsonSetter("title")
    public void setTitle(String title) {
        this.titlePresent = true;
        this.title = title;
    }

    @JsonSetter("description")
    public void setDescription(String description) {
        this.descriptionPresent = true;
        this.description = description;
    }

    @JsonSetter("scheduledAt")
    public void setScheduledAt(Instant scheduledAt) {
        this.scheduledAtPresent = true;
        this.scheduledAt = scheduledAt;
    }

    @JsonSetter("meetingPosition")
    public void setMeetingPosition(GeoJsonPoint meetingPosition) {
        this.meetingPositionPresent = true;
        this.meetingPosition = meetingPosition;
    }

    @JsonSetter("meetingPlaceName")
    public void setMeetingPlaceName(String meetingPlaceName) {
        this.meetingPlaceNamePresent = true;
        this.meetingPlaceName = meetingPlaceName;
    }

    @JsonSetter("meetingAddress")
    public void setMeetingAddress(String meetingAddress) {
        this.meetingAddressPresent = true;
        this.meetingAddress = meetingAddress;
    }

    @JsonSetter("courseId")
    public void setCourseId(Long courseId) {
        this.courseIdPresent = true;
        this.courseId = courseId;
    }

    @JsonSetter("targetDistanceM")
    public void setTargetDistanceM(Integer targetDistanceM) {
        this.targetDistanceMPresent = true;
        this.targetDistanceM = targetDistanceM;
    }

    @JsonSetter("goalInputType")
    public void setGoalInputType(String goalInputType) {
        this.goalInputTypePresent = true;
        this.goalInputType = goalInputType;
    }

    @JsonSetter("targetDurationSec")
    public void setTargetDurationSec(Integer targetDurationSec) {
        this.targetDurationSecPresent = true;
        this.targetDurationSec = targetDurationSec;
    }

    @JsonSetter("targetPaceSecPerKm")
    public void setTargetPaceSecPerKm(Integer targetPaceSecPerKm) {
        this.targetPaceSecPerKmPresent = true;
        this.targetPaceSecPerKm = targetPaceSecPerKm;
    }

    public String title() {
        return title;
    }

    public boolean titlePresent() {
        return titlePresent;
    }

    public String description() {
        return description;
    }

    public boolean descriptionPresent() {
        return descriptionPresent;
    }

    public Instant scheduledAt() {
        return scheduledAt;
    }

    public boolean scheduledAtPresent() {
        return scheduledAtPresent;
    }

    public GeoJsonPoint meetingPosition() {
        return meetingPosition;
    }

    public boolean meetingPositionPresent() {
        return meetingPositionPresent;
    }

    public String meetingPlaceName() {
        return meetingPlaceName;
    }

    public boolean meetingPlaceNamePresent() {
        return meetingPlaceNamePresent;
    }

    public String meetingAddress() {
        return meetingAddress;
    }

    public boolean meetingAddressPresent() {
        return meetingAddressPresent;
    }

    public Long courseId() {
        return courseId;
    }

    public boolean courseIdPresent() {
        return courseIdPresent;
    }

    public Integer targetDistanceM() {
        return targetDistanceM;
    }

    public boolean targetDistanceMPresent() {
        return targetDistanceMPresent;
    }

    public String goalInputType() {
        return goalInputType;
    }

    public boolean goalInputTypePresent() {
        return goalInputTypePresent;
    }

    public Integer targetDurationSec() {
        return targetDurationSec;
    }

    public boolean targetDurationSecPresent() {
        return targetDurationSecPresent;
    }

    public Integer targetPaceSecPerKm() {
        return targetPaceSecPerKm;
    }

    public boolean targetPaceSecPerKmPresent() {
        return targetPaceSecPerKmPresent;
    }

    public boolean anyGoalFieldPresent() {
        return goalInputTypePresent
                || targetDistanceMPresent
                || targetDurationSecPresent
                || targetPaceSecPerKmPresent;
    }
}
