-- Index preview (#18): a candidate profile is a hidden copy of a knowledge base's profile with some settings changed, made so the new
-- index can be built and evaluated beside the live one. It is the migration's target, and until an admin switches it, nothing
-- else may use it: it is left out of every list and picker, is never the default, and a source or knowledge base cannot select it.
--
-- candidate_of: the profile it was copied from. NULL for every real profile, so existing rows and the previous version are unaffected.
-- No ON DELETE clause: a profile with candidates is not deleted from under them.

-- +goose Up
ALTER TABLE embedding_profiles
    ADD COLUMN candidate_of uuid REFERENCES embedding_profiles (id),
    ADD CONSTRAINT embedding_profiles_candidate_not_default CHECK (candidate_of IS NULL OR NOT is_default),
    ADD CONSTRAINT embedding_profiles_candidate_not_self CHECK (candidate_of IS DISTINCT FROM id);

-- +goose Down
ALTER TABLE embedding_profiles
    DROP CONSTRAINT embedding_profiles_candidate_not_self,
    DROP CONSTRAINT embedding_profiles_candidate_not_default,
    DROP COLUMN candidate_of;
