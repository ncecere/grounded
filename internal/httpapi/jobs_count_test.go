package httpapi_test

// requestJobs counts the jobs a request could have queued: every River job except those the worker's own schedule
// inserts (River marks them metadata.periodic). A test that says "this changed nothing" compares it, so a maintenance
// tick that happens to land during the test (an ingest dispatch every 5 s, a minute's sweep) is not mistaken for work.
const requestJobs = "SELECT count(*) FROM river_job WHERE NOT coalesce((metadata->>'periodic')::boolean, false)"
