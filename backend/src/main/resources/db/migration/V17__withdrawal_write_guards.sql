-- S15P31E105-248: serialize resource writes with withdrawal, without new tables.
CREATE FUNCTION runway_guard_active_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner_id bigint;
    second_owner bigint;
    related_id bigint;
    account record;
    parent_deleted timestamptz;
    session_owned boolean;
BEGIN
    related_id := (to_jsonb(NEW)->>TG_ARGV[1])::bigint;
    IF TG_ARGV[0] = 'user' THEN owner_id := related_id;
    ELSIF TG_ARGV[0] = 'session' THEN
        SELECT user_id INTO owner_id FROM running_sessions WHERE id=related_id FOR SHARE;
    ELSIF TG_ARGV[0] = 'device' THEN
        SELECT user_id INTO owner_id FROM user_devices WHERE id=related_id;
    ELSIF TG_ARGV[0] = 'plan' THEN
        SELECT s.user_id INTO owner_id FROM pace_plans p
            JOIN running_sessions s ON s.id=p.session_id WHERE p.id=related_id FOR SHARE OF s;
    END IF;
    IF TG_TABLE_NAME = 'user_follows' THEN
        second_owner := (to_jsonb(NEW)->>'followee_id')::bigint;
    ELSIF TG_TABLE_NAME = 'follow_request_history' THEN
        second_owner := (to_jsonb(NEW)->>'target_id')::bigint;
    END IF;
    -- Session writers serialize on their parent session, which withdrawal locks before scrubbing.
    -- They must not lock users after sessions: W04 and existing W07 have a different lock order.
    session_owned := TG_ARGV[0] IN ('session','plan')
        OR (TG_TABLE_NAME='running_sessions' AND TG_OP='UPDATE');
    IF TG_TABLE_NAME='sync_batches' AND related_id IS NULL THEN
        SELECT user_id INTO owner_id FROM user_devices
            WHERE id=(to_jsonb(NEW)->>'device_id')::bigint;
        session_owned := false;
    END IF;
    IF session_owned THEN
        FOR account IN SELECT account_status::text AS state,withdrawn_at FROM users
            WHERE id=owner_id
        LOOP
            IF account.state <> 'ACTIVE' OR account.withdrawn_at IS NOT NULL THEN
                RAISE EXCEPTION 'Resource owner is not active'
                    USING ERRCODE='23514',CONSTRAINT='rw_active_owner';
            END IF;
        END LOOP;
    ELSE
        -- A missing owner remains the original FK violation. Never wait in reverse lock order.
        FOR account IN SELECT account_status::text AS state,withdrawn_at FROM users
            WHERE id=ANY(ARRAY[owner_id,second_owner]) ORDER BY id FOR KEY SHARE NOWAIT
        LOOP
            IF account.state <> 'ACTIVE' OR account.withdrawn_at IS NOT NULL THEN
                RAISE EXCEPTION 'Resource owner is not active'
                    USING ERRCODE='23514',CONSTRAINT='rw_active_owner';
            END IF;
        END LOOP;
    END IF;
    IF TG_OP = 'INSERT' THEN
        related_id := NULL;
        IF TG_TABLE_NAME IN ('comments','post_likes') THEN related_id := (to_jsonb(NEW)->>'post_id')::bigint;
        ELSIF TG_TABLE_NAME = 'notifications' AND to_jsonb(NEW)->>'notification_type'='POST_COMMENT' THEN
            related_id := (to_jsonb(NEW)->>'target_id')::bigint;
        END IF;
        IF related_id IS NOT NULL THEN
            SELECT deleted_at INTO parent_deleted FROM posts WHERE id=related_id FOR SHARE;
            IF FOUND AND parent_deleted IS NOT NULL THEN
                RAISE EXCEPTION 'Parent post is unavailable'
                    USING ERRCODE='23514',CONSTRAINT='rw_active_post';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE spec record;
BEGIN
    FOR spec IN SELECT * FROM (VALUES
        ('user_profiles','user','user_id'),
        ('user_settings','user','user_id'),
        ('user_recommendation_preferences','user','user_id'),
        ('user_hr_personalization','user','user_id'),
        ('daily_health_metrics','user','user_id'),
        ('daily_readiness','user','user_id'),
        ('course_bookmarks','user','user_id'),
        ('post_likes','user','user_id'),
        ('user_follows','user','follower_id'),
        ('follow_request_history','user','requester_id'),
        ('notifications','user','user_id'),
        ('user_devices','user','user_id'),
        ('crew_memberships','user','user_id'),
        ('crews','user','owner_id'),
        ('group_runs','user','host_id'),
        ('group_run_participants','user','user_id'),
        ('posts','user','author_id'),
        ('comments','user','author_id'),
        ('running_sessions','user','user_id'),
        ('running_metric_samples','session','running_session_id'),
        ('running_route_points','session','running_session_id'),
        ('running_session_splits','session','running_session_id'),
        ('session_control_events','session','session_id'),
        ('coaching_decisions','session','session_id'),
        ('pace_plans','session','session_id'),
        ('pace_plan_segments','plan','pace_plan_id'),
        ('sync_batches','session','session_id')
    ) AS guards(table_name,owner_kind,owner_column)
    LOOP
        EXECUTE format('CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON %I '
            || 'FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner(%L,%L)',
            spec.table_name,spec.owner_kind,spec.owner_column);
    END LOOP;
END;
$$;
