# Rotating `ENCRYPTION_KEY` and `API_KEY_PEPPER`

Grounded has two install-wide secrets:

| Secret | What it protects | How it rotates |
|---|---|---|
| `ENCRYPTION_KEY` | Secrets stored in the database, today the model connections' API keys (AES-256-GCM, `internal/secrets`) | `grounded rotate-keys` re-encrypts every stored value with the new key. Until then the server reads with both keys. |
| `API_KEY_PEPPER` | API keys (`rag_…`) and widget keys (`pk_…`), stored only as HMAC digests | Digests can't be recomputed without the key, so each key is re-hashed with the new pepper **the next time it is used**, while the old pepper is kept as `API_KEY_PEPPER_PREVIOUS`. |

Other secrets (`OIDC_CLIENT_SECRET`, `SMTP_PASSWORD`, `TURNSTILE_SECRET_KEY`, S3 and database passwords) aren't stored by Grounded. Change them where they're issued and in your secret store.

Rotate when a key may have leaked, when someone who knew it leaves, on your schedule, and to move an install off the example values in `.env.example`, which production refuses to start with. For that last case, the example values are the "old" keys in the steps below.

Rotating one secret doesn't require rotating the other. Both can be done together.

## How it works

- **Ciphertexts name their key.** Every stored value is `version (1 byte) | key id (8 bytes, from SHA-256 of the key) | nonce | sealed data`. The server knows which key to use, and `rotate-keys` knows which values are still on the old one. Every value written since the first release has this format.
- **Reads use both keys; writes use the new one.** With `ENCRYPTION_KEY_PREVIOUS` set, values sealed with either key decrypt. New or re-saved values are sealed with `ENCRYPTION_KEY`.
- **`grounded rotate-keys`:**
  - It first checks that every stored value decrypts. If any value decrypts with neither key, it lists the table and row id (never the value) and writes nothing.
  - It then re-encrypts, column by column, 100 rows per transaction (`--batch-size`), with row locks, skipping values already on the new key. It's idempotent, so an interrupted run can simply be run again.
  - It's safe while Grounded serves: an admin editing a connection at the same time waits for the row lock, and readers accept both keys throughout.
  - It records audit entries as the system (`platform.secrets_reencrypt` per batch, `platform.key_rotation` for the run), with counts only.
  - `--dry-run` checks and counts and writes nothing, not even the audit log.
- **Pepper.** Each key digest records the id of the pepper that made it (`pepper_id`). A key that matches `API_KEY_PEPPER_PREVIOUS` is re-hashed with `API_KEY_PEPPER` on that request, and the change is audited (`apikey.pepper_rehash`, `agent.publishable_key_pepper_rehash`). Keys never used during the grace period can't be re-hashed; once `API_KEY_PEPPER_PREVIOUS` is removed, they stop working and their owners create new ones.
- **Reports.** `grounded rotate-keys` lists the keys still on the previous pepper (id, name, team, agent, last use), and **Admin → Overview** shows a notice with the same list while any remain.

## Before you start

1. Take a database backup (the `backup-pgdump` CronJob, a CloudNativePG backup, or `pg_dump`).
2. **Keep the old values.** Backups taken before the rotation can only be read with the old `ENCRYPTION_KEY`. Keep it in your secret store, for example as an earlier version of the secret or under a separate "retired" path, for as long as you keep those backups.
3. Generate the new values:

   ```sh
   openssl rand -base64 32   # new ENCRYPTION_KEY
   openssl rand -base64 32   # new API_KEY_PEPPER
   ```

   Don't print them into shared terminals or chat. Write them straight into the secret store if you can.

## Rotate

The commands assume Kubernetes with the base manifests (namespace `grounded`, Deployments `grounded-api` and `grounded-worker`, runtime settings in the `grounded-runtime` Secret). With Docker Compose or a single binary, change the environment and restart the process instead of the `kubectl` steps, and run the same `grounded rotate-keys` commands.

### 1. Set the new values, keeping the old ones as `*_PREVIOUS`

In the secret behind `grounded-runtime`:

| Setting | New value |
|---|---|
| `ENCRYPTION_KEY_PREVIOUS` | the current (old) `ENCRYPTION_KEY` |
| `ENCRYPTION_KEY` | the new key |
| `API_KEY_PEPPER_PREVIOUS` | the current (old) `API_KEY_PEPPER` |
| `API_KEY_PEPPER` | the new pepper |

If you rotate only one secret, set only its pair.

**With External Secrets and OpenBao or Vault**, update the source secret. For example, with the keys at `secret/grounded/runtime`:

```sh
bao kv get -field=ENCRYPTION_KEY secret/grounded/runtime   # the old key: keep it
bao kv patch secret/grounded/runtime \
  ENCRYPTION_KEY_PREVIOUS="<old ENCRYPTION_KEY>" ENCRYPTION_KEY="<new key>" \
  API_KEY_PEPPER_PREVIOUS="<old API_KEY_PEPPER>" API_KEY_PEPPER="<new pepper>"
```

`kv patch` keeps the other keys, and KV v2 keeps the previous version of the secret. Then make the operator sync now rather than at its next refresh, and check that it did:

```sh
kubectl -n grounded annotate externalsecret grounded-runtime force-sync="$(date +%s)" --overwrite
kubectl -n grounded get externalsecret grounded-runtime   # READY True, a recent refresh
```

If your `ExternalSecret` lists keys one by one (`data:`) rather than extracting the whole path (`dataFrom:`), add `ENCRYPTION_KEY_PREVIOUS` and `API_KEY_PEPPER_PREVIOUS` to it first.

**With a plain Secret:**

```sh
kubectl -n grounded patch secret grounded-runtime --type merge -p '{"stringData": {
  "ENCRYPTION_KEY_PREVIOUS": "<old>", "ENCRYPTION_KEY": "<new>",
  "API_KEY_PEPPER_PREVIOUS": "<old>", "API_KEY_PEPPER": "<new>"}}'
```

### 2. Roll every pod

Settings are read at start, so restart both Deployments and wait for them:

```sh
kubectl -n grounded rollout restart deploy/grounded-api deploy/grounded-worker
kubectl -n grounded rollout status deploy/grounded-api
kubectl -n grounded rollout status deploy/grounded-worker
```

From now on, new secrets are sealed with the new key and API keys are re-hashed as they're used. During the rollout, old pods still seal with the old key. That's harmless: new pods read both keys, and `rotate-keys` checks at the end that nothing is left on the old key.

### 3. Dry run

```sh
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded rotate-keys --dry-run
```

(The image is distroless: the binary is `/grounded`, and there is no shell.) The output looks like this:

```
Encryption key: current key id 3f9a0c21. Checking 1 encrypted column(s)...
  model_connections.api_key_ciphertext: 4 stored, 0 on the current key, 4 on the previous key, 0 undecryptable

API key pepper: API_KEY_PEPPER_PREVIOUS is set; keys on it are re-hashed with API_KEY_PEPPER when next used.
  3 key(s) are still on the previous pepper. They stop working when API_KEY_PEPPER_PREVIOUS is removed unless they are used before then.
  STATE     KIND             ID                                    NAME       TEAM       AGENT      LAST USED
  previous  api_key          6c1d…                                 loader     registrar  -          2026-09-26 14:02Z
  …

Dry run: nothing was written.
```

If it reports undecryptable values, stop. Those values were written with a key that is neither the current nor the previous one, for example after an earlier key change that wasn't a rotation. Either set that key as `ENCRYPTION_KEY_PREVIOUS` for this run, or re-enter the affected connections' API keys in **Admin → Connections** (the ids are the connection ids).

### 4. Re-encrypt

```sh
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded rotate-keys
```

It prints progress per batch and ends with `Every stored secret is on the current key` and `Done: N secret(s) re-encrypted`. If it's interrupted (a lost connection, a pod restart), run it again: it continues with the values still on the old key.

If you rotate only the pepper, use `/grounded rotate-keys --pepper-only`. It doesn't need `ENCRYPTION_KEY_PREVIOUS` and doesn't touch encrypted values.

Both forms also record the previous pepper's id on key digests from before pepper tracking, so a key that isn't used during the grace period is still reported afterwards.

### 5. Verify

- `rotate-keys --dry-run` again reports `0 on the previous key` for every column.
- In **Admin → Connections**, open each connection and use **Test connection**: it decrypts the stored key and calls the gateway.
- Ask a chat question, or call the API with an existing key:

  ```sh
  curl -fsS -H "Authorization: Bearer $KEY" https://grounded.example.edu/v1/teams/<team>/kbs >/dev/null && echo ok
  ```

- **Admin → Logs** (audit log) shows the `Re-encrypted stored secrets` and `Rotated keys` entries.

### 6. Remove `ENCRYPTION_KEY_PREVIOUS`

Once step 5 passes, delete `ENCRYPTION_KEY_PREVIOUS` from the secret (`bao kv patch` can't delete a field: `bao kv get` the secret, then `bao kv put` it back without that field), sync, and roll the pods again as in step 2. The old key now only reads backups taken before the rotation: keep it filed away for as long as you keep them (see "Before you start").

### 7. Retire `API_KEY_PEPPER_PREVIOUS` after a grace period

Keep `API_KEY_PEPPER_PREVIOUS` long enough for every key in regular use to be used once. Two to four weeks suits most installs, longer if some integrations run monthly. During the grace period:

- **Admin → Overview** shows "N keys still on the previous API key pepper". **Show keys** lists them with their team and last use.
- `/grounded rotate-keys --pepper-only --dry-run` prints the same list.

Ask the teams that own listed keys to use them once, or to replace them. When you remove `API_KEY_PEPPER_PREVIOUS` and roll the pods, **every key still listed stops working** (401). The owners then create new keys in their team's settings. Afterwards, the Overview lists such keys as "no longer works" until they're revoked.

## Rollback

- **Before `rotate-keys` has run:** put the old values back as `ENCRYPTION_KEY` and `API_KEY_PEPPER`, and set the new ones as the `*_PREVIOUS` values, so anything already written with the new key still reads. Roll the pods.
- **After `rotate-keys` has run:** swap the values the same way (old key current, new key previous), roll the pods, and run `rotate-keys` again. It re-encrypts everything back to the old key. Then remove the `*_PREVIOUS` value.
- **Pepper:** swapping the peppers works the same way. Keys already re-hashed with the new pepper still work through `API_KEY_PEPPER_PREVIOUS`, and are re-hashed back when used.
- **Never remove a key that stored values still need.** If `ENCRYPTION_KEY_PREVIOUS` was removed too early, connections show "The stored API key cannot be decrypted". Put the key back as `ENCRYPTION_KEY_PREVIOUS`, roll the pods, and run `rotate-keys`. Nothing is lost while some copy of the old key exists.
- **Restoring a backup** taken before the rotation needs the old `ENCRYPTION_KEY`. Restore, set the old key as `ENCRYPTION_KEY_PREVIOUS` (with the new key current), and run `rotate-keys`.

## Side effects

- **Analytics pseudonyms change with the pepper.** Grounded derives the pseudonymous user ids recorded for analytics from `API_KEY_PEPPER` (ADR-0010). After a pepper rotation the same person gets a new pseudonym, so unique-user counts over a period that spans the rotation count them twice. Older records keep their old pseudonyms. That is intended: a leaked pepper would otherwise let someone link pseudonyms to user ids.
- Browser sessions, OIDC, anonymous widget sessions and stored documents don't depend on either key.
