#!/usr/bin/env python3
"""Explicit live, read-only Secret contract check. Never invoked by rendering.

No network reachability claim: endpoints must subsequently pass doctor/readiness.
Only named Secrets in the explicitly selected namespace/context are fetched.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
from urllib.parse import parse_qs, urlsplit, unquote
import yaml


def check(v, runtime, s3, smtp=None, owned_keys=()):
    required = ['DATABASE_URL', 'VALKEY_URL', 'ENCRYPTION_KEY', 'API_KEY_PEPPER']
    if not all(runtime.get(k) for k in required) or not all(s3.get(k) for k in ('access_key', 'secret_key')):
        raise ValueError('missing required Secret keys')
    # envFrom must not override generated safety/config values.
    forbidden = {'DEV_AUTH', 'APP_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'OCR_TESSERACT_URL'}
    forbidden.update(owned_keys)
    if forbidden.intersection(runtime):
        raise ValueError('runtime Secret overrides chart-owned configuration')
    if smtp and any(not key.startswith('SMTP_') for key in smtp):
        raise ValueError('SMTP Secret may only contain SMTP settings')
    for role, key, schemes, port in [('postgres', 'DATABASE_URL', ('postgres', 'postgresql'), 5432),
                                     ('valkey', 'VALKEY_URL', ('redis', 'rediss'), 6379)]:
        url = urlsplit(runtime[key])
        if url.scheme not in schemes or not url.username and role == 'postgres' or not url.password:
            raise ValueError('datastore URL requires supported scheme and authentication')
        if v[role] == 'bundled':
            if url.hostname != 'grounded-' + role or (url.port or port) != port:
                raise ValueError('bundled URL destination mismatch')
            password = runtime.get('POSTGRES_PASSWORD' if role == 'postgres' else 'VALKEY_PASSWORD')
            if not password or unquote(url.password) != password:
                raise ValueError('missing bundled password key')
        else:
            d = v[role + 'Destination']
            if url.hostname != d['host'] or (url.port or port) != d['port']:
                raise ValueError('external URL destination mismatch')
            if role == 'postgres' and parse_qs(url.query).get('sslmode') != ['verify-full']:
                raise ValueError('external Postgres requires sslmode=verify-full')
            if role == 'valkey' and (url.scheme != 'rediss' or url.query):
                raise ValueError('external Valkey requires rediss TLS')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ('kubeconfig', 'context', 'namespace', 'values'):
        p.add_argument('--' + key, required=True)
    args = p.parse_args()
    v = yaml.safe_load(Path(args.values).read_text())
    chart = Path(__file__).resolve().parents[1] / 'grounded'
    # Validate merged values offline first, then read only the three named Secrets (SMTP may be absent).
    rendered = subprocess.run(['helm', 'template', 'preflight', str(chart), '-n', args.namespace,
                    '-f', args.values], capture_output=True, text=True, check=True, timeout=90)
    owned = set()
    for obj in yaml.safe_load_all(rendered.stdout):
        if obj and obj['kind'] == 'ConfigMap': owned.update(obj.get('data', {}))
    defaults = yaml.safe_load((chart / 'values.yaml').read_text()); defaults.update(v); v = defaults

    def secret(name, optional=False):
        r = subprocess.run(['kubectl', '--kubeconfig', args.kubeconfig, '--context', args.context,
            '--namespace', args.namespace, '--request-timeout=10s', 'get', 'secret', name, '-o', 'json'] + (['--ignore-not-found'] if optional else []),
            capture_output=True, check=True, timeout=15)
        if optional and not r.stdout.strip(): return {}
        return {k: base64.b64decode(val, validate=True).decode() for k, val in json.loads(r.stdout).get('data', {}).items()}
    try:
        check(v, secret(v['runtimeSecret']), secret(v['s3Secret']),
              secret(v['smtpSecret'], optional=True), owned)
    except Exception:
        # Do not emit subprocess output, URLs, credentials or exception text.
        raise SystemExit('preflight failed: Secret access or datastore contract invalid (no contents logged)') from None
    print('Secret contract checked; live TLS/reachability and doctor still required')


if __name__ == '__main__':
    main()
