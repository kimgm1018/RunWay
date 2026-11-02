package com.runway.backend.domain.user.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonSetter;

/**
 * U05 PATCH. 생략은 유지. {@code profileImageId: null}은 프로필 사진 삭제.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class UpdateProfileRequest {

    private String nickname;
    private boolean nicknamePresent;

    private String gender;
    private boolean genderPresent;

    private String birthDate;
    private boolean birthDatePresent;

    private String profileImageId;
    private boolean profileImageIdPresent;

    @JsonSetter("nickname")
    public void setNickname(String nickname) {
        this.nicknamePresent = true;
        this.nickname = nickname;
    }

    @JsonSetter("gender")
    public void setGender(String gender) {
        this.genderPresent = true;
        this.gender = gender;
    }

    @JsonSetter("birthDate")
    public void setBirthDate(String birthDate) {
        this.birthDatePresent = true;
        this.birthDate = birthDate;
    }

    @JsonSetter("profileImageId")
    public void setProfileImageId(String profileImageId) {
        this.profileImageIdPresent = true;
        this.profileImageId = profileImageId;
    }

    public boolean nicknamePresent() {
        return nicknamePresent;
    }

    public String nickname() {
        return nickname;
    }

    public boolean genderPresent() {
        return genderPresent;
    }

    public String gender() {
        return gender;
    }

    public boolean birthDatePresent() {
        return birthDatePresent;
    }

    public String birthDate() {
        return birthDate;
    }

    public boolean profileImageIdPresent() {
        return profileImageIdPresent;
    }

    public String profileImageId() {
        return profileImageId;
    }

    public boolean hasAnyField() {
        return nicknamePresent || genderPresent || birthDatePresent || profileImageIdPresent;
    }

    @Override
    public String toString() {
        return "UpdateProfileRequest[REDACTED]";
    }
}
