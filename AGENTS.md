# Agent notes

Conventions for building and testing are in [CONTRIBUTING.md](CONTRIBUTING.md). This file covers what
is specific to working with an AI agent: running the code on the homelab cluster instead of the
laptop.

## Running a branch on the cluster

A branch can be tested as a running copy of Grounded on the bitop-talos cluster: its own Postgres
with pgvector, Valkey, an S3 server and a mail catcher, removed automatically after 8 hours.

1. **Push the branch.** The `branch-images` workflow (`.github/workflows/branch-images.yml`) builds
   `ghcr.io/ncecere/grounded:dev-<first 12 characters of the commit>` (and `grounded-ocr`), amd64
   only, in a few minutes. It runs on every branch push and does not wait for the tests. A branch
   cut before that workflow existed has no images: rebase it onto `main`. The full `ci` workflow
   also runs on every push (about an hour); the image does not depend on it.
2. **Create the environment** with the `dev-env` tool from the homelab checkout:

   ```sh
   DEVENV=~/homelab/bitop-talos/tools/dev-env/dev-env
   $DEVENV up grounded my-name --ref my-branch   # ~30 s; checks the image exists first
   $DEVENV forward grounded my-name              # http://localhost:<port>, leave running
   $DEVENV creds grounded my-name                # how to sign in (see below)
   $DEVENV forward grounded my-name --mail       # the mail catcher (every email the app sends)
   ```

   `--ref` takes a branch, tag or commit of this clone, or a release such as `v0.4.2` (the release's
   own manifests and image). The tool deploys **the `deploy/kubernetes/base` of the ref you name**,
   so a change to the manifests is tested too. The kubeconfig is `~/homelab/bitop-talos/kubeconfig`;
   the tool needs `kubectl` and Python 3 with PyYAML.
3. **Extend or stop it:** `$DEVENV renew grounded my-name --ttl 8h`, `$DEVENV list`,
   `$DEVENV status grounded my-name`, `$DEVENV down grounded my-name`. Always `down` an environment
   you are done with. Names are 2-20 characters (lowercase letters, digits, dashes).
4. **Check it** with Grounded's own command, inside the API pod:

   ```sh
   kubectl --kubeconfig ~/homelab/bitop-talos/kubeconfig -n dev-grounded \
     exec deploy/my-name-grounded-api -c api -- /grounded doctor
   ```

   It tests Postgres (version, pgvector, migrations), Valkey and a write, read and delete in S3.

The tool's own documentation is `tools/dev-env/README.md` in the homelab repo.

## Signing in

There are no passwords. The environment runs with `DEV_AUTH=true`, which Grounded allows only because
`APP_URL` is the loopback address of the port-forward (`http://localhost:<port>`, printed by `up`).
Open the forwarded address and pick a persona: `admin@localhost` (platform admin), `auditor@localhost`,
or `user@localhost`, `alex@localhost`, `blair@localhost`, `casey@localhost` (no platform role). From a
script, `POST /auth/dev {"account":"admin"}` with `Origin` and `Host` set to the app address. Always
use the port that `up` printed: the host must match `APP_URL`.

## What an environment is, and is not

- It runs in the `dev-grounded` namespace only. **Never** deploy, apply or edit anything in
  `grounded` (production) or in any other namespace to test a change.
- One API and one worker, no limits, low scheduling priority: the environment yields to production
  rather than being capped, so a heavy test can be slow when the cluster is busy. Do not leave
  environments running.
- Database: Postgres **18** with pgvector 0.8.7. Production is Postgres 17 (pgvector 0.8.6), so a
  result that depends on the server version needs checking against 17 locally.
- Object storage is a disposable S3 server inside the environment (bucket `grounded`); its contents
  go with the environment. There is no OCR sidecar and no model server yet: connect models through
  the admin pages if a test needs them.
- Reach it by port-forward only; there is no ingress.
- Secrets are generated for each environment and kept in the cluster. Do not print or commit them.
- The cluster is shared with production services: keep tests bounded and remove what you create.

## Not available yet

Only environments exist. The Go tests, the end-to-end suites, the Kubernetes smoke test, the load
tests and the screenshot capture still run locally or on GitHub (see CONTRIBUTING.md). Running them
as Jobs on the cluster is planned.
