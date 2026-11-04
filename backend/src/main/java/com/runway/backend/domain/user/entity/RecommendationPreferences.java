package com.runway.backend.domain.user.entity;

import com.runway.backend.domain.user.model.PreferenceSelection;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.NoArgsConstructor;

import java.util.LinkedHashMap;

@Entity
@Table(name = "user_recommendation_preferences")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RecommendationPreferences {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, unique = true, updatable = false)
    private Long userId;

    @Column(nullable = false, length = 16)
    private String shape;

    @Column(name = "river", nullable = false)
    private boolean river;

    @Column(name = "beach", nullable = false)
    private boolean beach;

    @Column(name = "park", nullable = false)
    private boolean park;

    @Column(name = "trail", nullable = false)
    private boolean trail;

    @Column(name = "pedestrian", nullable = false)
    private boolean pedestrian;

    @Column(name = "flat", nullable = false)
    private boolean flat;

    @Column(name = "avoid_major_road", nullable = false)
    private boolean avoidMajorRoad;

    @Column(name = "avoid_steps", nullable = false)
    private boolean avoidSteps;

    @Column(name = "avoid_tunnel", nullable = false)
    private boolean avoidTunnel;

    public static RecommendationPreferences create(long userId, PreferenceSelection selection) {
        var preferences = new RecommendationPreferences();
        preferences.userId = userId;
        preferences.replace(selection);
        return preferences;
    }

    public void replace(PreferenceSelection selection) {
        shape = selection.shape();
        river = selection.filters().get("river");
        beach = selection.filters().get("beach");
        park = selection.filters().get("park");
        trail = selection.filters().get("trail");
        pedestrian = selection.filters().get("pedestrian");
        flat = selection.filters().get("flat");
        avoidMajorRoad = selection.filters().get("avoid_major_road");
        avoidSteps = selection.filters().get("avoid_steps");
        avoidTunnel = selection.filters().get("avoid_tunnel");
    }

    public PreferenceSelection selection() {
        var values = new LinkedHashMap<String, Boolean>();
        values.put("river", river);
        values.put("beach", beach);
        values.put("park", park);
        values.put("trail", trail);
        values.put("pedestrian", pedestrian);
        values.put("flat", flat);
        values.put("avoid_major_road", avoidMajorRoad);
        values.put("avoid_steps", avoidSteps);
        values.put("avoid_tunnel", avoidTunnel);
        return new PreferenceSelection(shape, values);
    }
}
