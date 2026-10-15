# Evaluation set: the Grounded docs site

`grounded-docs.csv` is 96 retrieval questions about Grounded, each with the docs page(s) that answer it and a phrase a correct answer must
contain. It is for [Evaluations](../../../evaluations.md) in the format the import takes (`question,expected,must_mention,note`; `|` between
several values) and was built for the index-preview work ([#18](https://github.com/ncecere/grounded/issues/18)) and the index-quality
measurement ([#25](https://github.com/ncecere/grounded/issues/25)): the docs site describes this very software, so the answers are known.

## Using it

1. In a team with evaluations on, make a knowledge base whose source is a web source crawling `https://docs.grounded.bitop.dev/docs`
   (the site has no sitemap; the crawl follows the links).
2. Make an evaluation set on that knowledge base, then **Import** the CSV. Run it as a dry run first: every row should be usable.
3. Run the set (retrieval only is enough). `expected` are page URLs, so a hit is a retrieved passage from one of them.

## What it covers and how it was checked (2026-10-14)

- 62 pages: Administration (21 pages), Using (19), Self-hosting (14), Getting started (4), API (4). The ten release-note pages are left out
  (a changelog makes poor questions), and so are the two section index pages, which only link to other pages. 60 of the 62 have at least one
  question; Administration has 32, Using 31, Self-hosting 20, API 9, Getting started 4.
- Questions were drafted by AI agents that read each page, to be phrased as a person with the problem would, not as the page title (9 of 96
  largely repeat a title's words). **They are not real users' questions.**
- Checked by script, not by the agents' word: every URL answered 200; every `must_mention` phrase appears verbatim (case-insensitive) in
  that page's rendered text; no question repeats. All 96 pass; the importer's own parser accepts all 96 rows with no problems.
- 37 questions share their phrases with another page. A second pass read those pages and kept one only if it states the same answer, with
  the quote checked against the page text: 25 questions accept two or more pages (34 extra pages). A hit on any accepted page counts. One
  of the 34 is borderline (a page that states the rule for counting uncited claims, for a question about the claims array).

## Limits

- One page per question, not one passage: it shows whether retrieval finds the right page, not whether the right sentence is in the
  top results (`must_mention` covers that in a full-answer run, not in retrieval-only).
- Every question has an answer; none tests what retrieval does when the docs hold nothing.
- It goes stale as the docs change. Re-check the URLs and phrases against the live pages before relying on a result, and treat a question
  whose page changed as suspect, not as a regression.
- A knowledge base made from the docs site is small (62 pages, a few hundred passages). A result here says little about a large or messy
  one; it is a regression and comparison tool for index settings, not a benchmark.
