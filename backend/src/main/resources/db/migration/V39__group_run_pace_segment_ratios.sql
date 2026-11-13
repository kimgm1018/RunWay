-- S15P31E105-739. km segment ratios of the start plan's basis member (AI09), applied to the start pace for G03.
ALTER TABLE group_run_pace_state
    ADD COLUMN start_segment_ratios JSONB
        CHECK (start_segment_ratios IS NULL OR jsonb_typeof(start_segment_ratios) = 'array');
