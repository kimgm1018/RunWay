ALTER TABLE courses ADD COLUMN is_private boolean NOT NULL DEFAULT false;
ALTER TABLE courses ADD COLUMN unmeasured_edges jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX uq_courses_source_session ON courses(source_session_id)
    WHERE source_session_id IS NOT NULL;
