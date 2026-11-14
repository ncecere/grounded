-- The links of each stored web page (#250), so an unchanged page's links are followed without reading the page back
-- from object storage on every sync. Expand only: a new table that a pod of the previous release ignores (it reads the
-- stored page, as before). A row belongs to one stored version of its page (sha256, the document's digest); a page
-- without a row, or with one for another version, is read back as before and gets one.
--
-- links are every link of the page a crawl could follow (crawl.Links, at most MaxURLBytes each), whatever the source's
-- scope: the scope and depth are applied by each run, and may change between runs.

-- +goose Up
CREATE TABLE web_page_links (
    document_id uuid   PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
    sha256      text   NOT NULL,
    links       text[] NOT NULL
);

-- +goose Down
DROP TABLE IF EXISTS web_page_links;
