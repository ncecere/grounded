-- Re-fetching one page of a web source (docs/ui-review W3): a crawl run of
-- just that page's URL, recorded with trigger 'page'. Such a run follows no
-- links, removes no pages and leaves the source's schedule alone.

-- +goose Up
ALTER TABLE web_crawls DROP CONSTRAINT IF EXISTS web_crawls_trigger_check;
ALTER TABLE web_crawls ADD CONSTRAINT web_crawls_trigger_check
    CHECK (trigger IN ('create', 'manual', 'schedule', 'page'));

-- +goose Down
DELETE FROM web_crawls WHERE trigger = 'page';
ALTER TABLE web_crawls DROP CONSTRAINT IF EXISTS web_crawls_trigger_check;
ALTER TABLE web_crawls ADD CONSTRAINT web_crawls_trigger_check
    CHECK (trigger IN ('create', 'manual', 'schedule'));
