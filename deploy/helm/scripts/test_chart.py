#!/usr/bin/env python3
"""Independent Kustomize oracle: never imports generator or reads its templates."""
import difflib
import itertools
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
CHART = ROOT / 'deploy/helm/grounded'
K8S = ROOT / 'deploy/kubernetes'
HELM = os.getenv('HELM', 'helm')
KUSTOMIZE = os.getenv('KUSTOMIZE', 'kustomize')
NS = 'helm-test'


def command(*args, success=True):
    r = subprocess.run(args, text=True, capture_output=True, timeout=90)
    if success and r.returncode:
        raise AssertionError(f'{args}: exit {r.returncode}\n{r.stderr}\n{r.stdout}')
    return r


def values():
    v = yaml.safe_load((CHART / 'values.yaml').read_text())
    v.update(appImage='ghcr.io/ncecere/grounded@sha256:' + '1' * 64,
             runtimeSecret='install-runtime', s3Secret='install-s3')
    for role, port in [('postgres', 5432), ('valkey', 6379)]:
        v[role + 'Destination'] = dict(host='grounded-' + role, port=port, namespace=NS,
            podLabels={'app.kubernetes.io/name': 'grounded', 'app.kubernetes.io/component': role})
    return v


def helm(v, verb='template', success=True):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d, 'values.yaml')
        p.write_text(yaml.safe_dump(v))
        args = [HELM, verb, 'grounded', str(CHART)] if verb == 'template' else [HELM, verb, str(CHART), '--strict']
        return command(*args, '--namespace', NS, '-f', str(p), success=success)


def patch(kind, name, **fields):
    return {'patch': yaml.safe_dump({'apiVersion': 'v1' if kind == 'ConfigMap' else
            'apps/v1' if kind == 'Deployment' else 'networking.k8s.io/v1',
            'kind': kind, 'metadata': {'name': name}, **fields})}


def oracle(v):
    components = []
    if v['postgres'] == 'bundled': components.append('postgres-single')
    if v['valkey'] == 'bundled': components.append('valkey-single')
    for key, component in [('ocr', 'ocr-tesseract'), ('ingress', 'ingress'),
                           ('tracing', 'tracing'), ('monitoring', 'monitoring-annotations')]:
        if v[key]: components.append(component)
    config = {'APP_URL': v['appURL'], 'S3_ENDPOINT': v['s3Endpoint'], 'S3_BUCKET': v['s3Bucket']}
    if v['tracing']:
        config.update(OTEL_EXPORTER_OTLP_ENDPOINT=v['tracingEndpoint'],
                      OTEL_TRACES_SAMPLER_ARG=v['tracingSample'])
    patches = [patch('ConfigMap', 'grounded-config', data=config)]
    if v['ingress']:
        patches.append(patch('Ingress', 'grounded', spec={
            'ingressClassName': v['ingressClass'],
            'rules': [{'host': v['ingressHost'], 'http': {'paths': [{'path': '/', 'pathType': 'Prefix',
                'backend': {'service': {'name': 'grounded-api', 'port': {'name': 'http'}}}}]}}],
            'tls': [{'hosts': [v['ingressHost']], 'secretName': v['tlsSecret']}]}))
    for name, path, field in [
        ('grounded-api-ingress', '/spec/ingress/0/from/0/namespaceSelector/matchLabels/kubernetes.io~1metadata.name', 'ingressNamespace'),
        ('grounded-app-egress-tracing', '/spec/egress/0/to/0/namespaceSelector/matchLabels/kubernetes.io~1metadata.name', 'tracingNamespace'),
        ('grounded-allow-metrics-scrape', '/spec/ingress/0/from/0/namespaceSelector/matchLabels/kubernetes.io~1metadata.name', 'monitoringNamespace')]:
        if 'tracing' in name and not v['tracing']: continue
        if 'metrics' in name and not v['monitoring']: continue
        patches.append({'target': {'kind': 'NetworkPolicy', 'name': name},
                        'patch': yaml.safe_dump([{'op': 'replace', 'path': path, 'value': v[field]}])})
    for i, role in enumerate(('postgres', 'valkey')):
        if v[role] != 'external': continue
        d = v[role + 'Destination']
        peer = {'ipBlock': {'cidr': d['cidr']}} if 'cidr' in d else {
            'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': d['namespace']}},
            'podSelector': {'matchLabels': d['podLabels']}}
        patches.append({'target': {'kind': 'NetworkPolicy', 'name': 'grounded-app-egress-datastores'},
                        'patch': yaml.safe_dump([{'op': 'replace', 'path': f'/spec/egress/{i}',
                            'value': {'to': [peer], 'ports': [{'protocol': 'TCP', 'port': d['port']}]}}])})
    # Secret name changes are strategic patches on canonical references, not text templates.
    for role in ('api', 'worker'):
        def envfrom(smtp=False):
            refs = [{'configMapRef': {'name': 'grounded-config'}}, {'secretRef': {'name': v['runtimeSecret']}}]
            if smtp: refs.append({'secretRef': {'name': v['smtpSecret'], 'optional': True}})
            return refs
        changes = [
            {'op': 'replace', 'path': '/spec/template/spec/initContainers/0/envFrom', 'value': envfrom()},
            {'op': 'replace', 'path': '/spec/template/spec/containers/0/envFrom', 'value': envfrom(True)},
        ]
        for index in (1, 2):
            changes.append({'op': 'replace',
                'path': f'/spec/template/spec/containers/0/env/{index}/valueFrom/secretKeyRef/name',
                'value': v['s3Secret']})
        patches.append({'target': {'kind': 'Deployment', 'name': 'grounded-' + role},
                        'patch': yaml.safe_dump(changes)})
    for role in ('postgres', 'valkey'):
        if v[role] == 'bundled':
            patches.append({'target': {'kind': 'StatefulSet', 'name': 'grounded-' + role},
                            'patch': yaml.safe_dump([{'op': 'replace',
                            'path': '/spec/template/spec/containers/0/env/' + ('4' if role == 'postgres' else '0') + '/valueFrom/secretKeyRef/name',
                            'value': v['runtimeSecret']}])})
    images = [{'name': 'ghcr.io/ncecere/grounded', 'newName': v['appImage'].split('@')[0], 'digest': v['appImage'].split('@')[1]}]
    if v['ocr']:
        images.append({'name': 'ghcr.io/ncecere/grounded-ocr', 'newName': v['ocrImage'].split('@')[0], 'digest': v['ocrImage'].split('@')[1]})
    with tempfile.TemporaryDirectory(prefix='.helm-oracle-', dir=K8S) as d:
        k = {'apiVersion': 'kustomize.config.k8s.io/v1beta1', 'kind': 'Kustomization', 'namespace': NS,
             'resources': ['../base'], 'components': ['../components/' + c for c in components],
             'images': images, 'replicas': [{'name': 'grounded-' + role, 'count': v[role + 'Replicas']}
                for role in ('api', 'worker', 'ocr') if role != 'ocr' or v['ocr']], 'patches': patches}
        Path(d, 'kustomization.yaml').write_text(yaml.safe_dump(k))
        return command(KUSTOMIZE, 'build', d).stdout


def semantic(raw):
    objects = [o for o in yaml.safe_load_all(raw) if o]
    cms = [o['metadata']['name'] for o in objects if o['kind'] == 'ConfigMap']
    assert len(cms) == 1 and re.fullmatch(r'grounded-config-[a-z0-9]{10}', cms[0]), cms
    assert not any(o['kind'] == 'Secret' for o in objects)
    # Require all four app/migrate config references to resolve before normalization.
    refs = []
    for o in objects:
        if o['kind'] == 'Deployment' and o['metadata']['name'] in ('grounded-api', 'grounded-worker'):
            p = o['spec']['template']['spec']
            for c in p['containers'] + p['initContainers']:
                refs.extend(e['configMapRef']['name'] for e in c.get('envFrom', []) if 'configMapRef' in e)
    assert refs == [cms[0]] * 4, refs
    normalized = json.loads(json.dumps(objects).replace(cms[0], 'grounded-config-HASH'))
    keyed = {(o['apiVersion'], o['kind'], o['metadata'].get('namespace'), o['metadata']['name']): o for o in normalized}
    assert len(keyed) == len(objects), 'duplicate object identities'
    return json.dumps([keyed[k] for k in sorted(keyed)], indent=2, sort_keys=True)


class ChartTest(unittest.TestCase):
    def test_matrix(self):
        for bits in itertools.product((False, True), repeat=6):
            v = values()
            v.update(postgres='bundled' if bits[0] else 'external', valkey='bundled' if bits[1] else 'external',
                     ocr=bits[2], ingress=bits[3], tracing=bits[4], monitoring=bits[5],
                     ocrImage='ghcr.io/ncecere/grounded-ocr@sha256:' + '2' * 64,
                     apiReplicas=3, workerReplicas=4, ocrReplicas=2,
                     ingressClass='nginx', tlsSecret='install-tls', ingressNamespace='edge',
                     appURL='https://app.example.edu', ingressHost='app.example.edu',
                     s3Endpoint='https://objects.example.edu', s3Bucket='install-blobs',
                     tracingEndpoint='http://collector.telemetry.svc:4318', tracingNamespace='telemetry',
                     tracingSample='0.75', monitoringNamespace='metrics')
            for role in ('postgres', 'valkey'):
                if v[role] == 'bundled': v[role + 'Destination'] = {}
            with self.subTest(bits=bits):
                actual, expected = semantic(helm(v).stdout), semantic(oracle(v))
                self.assertEqual(actual, expected, '\n'.join(difflib.unified_diff(expected.splitlines(), actual.splitlines())))
                validator = os.getenv('KUBECONFORM', 'kubeconform')
                r = subprocess.run([validator, '-strict', '-summary', '-kubernetes-version', '1.34.0'],
                    input=helm(v).stdout, text=True, capture_output=True, timeout=90)
                self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


    def test_defaults(self):
        v = values()
        self.assertEqual(semantic(helm(v).stdout), semantic(oracle(v)))
        helm(v, 'lint')

    def test_manifest_upgrade_contract(self):
        before = helm(values()).stdout
        v = values(); v['s3Bucket'] = 'changed-bucket'
        after = helm(v).stdout
        def config_name(raw):
            return next(o['metadata']['name'] for o in yaml.safe_load_all(raw) if o and o['kind'] == 'ConfigMap')
        self.assertNotEqual(config_name(before), config_name(after))
        for raw in (before, after):
            for obj in yaml.safe_load_all(raw):
                if not obj: continue
                self.assertNotIn('helm.sh/hook', obj['metadata'].get('annotations', {}))
                self.assertNotEqual(obj['kind'], 'CustomResourceDefinition')
                if obj['kind'] == 'Deployment' and obj['metadata']['name'] != 'grounded-ocr':
                    pod = obj['spec']['template']['spec']
                    self.assertEqual(pod['initContainers'][0]['args'], ['migrate'])
                    self.assertEqual(pod['initContainers'][0]['image'], pod['containers'][0]['image'])
                    self.assertFalse(pod['automountServiceAccountToken'])
        bundled = values(); bundled.update(postgres='bundled', valkey='bundled', postgresDestination={}, valkeyDestination={})
        pg = next(o for o in yaml.safe_load_all(helm(bundled).stdout)
                  if o and o['kind'] == 'StatefulSet' and o['metadata']['name'] == 'grounded-postgres')
        self.assertEqual(pg['spec']['volumeClaimTemplates'][0]['spec']['resources']['requests']['storage'], '20Gi')
        self.assertNotIn('persistentVolumeClaimRetentionPolicy', pg['spec'])

    def test_negative_values(self):
        cases = [{'appImage': 'grounded:latest'}, {'runtimeSecret': ''}, {'s3Secret': ''},
                 {'apiReplicas': 0}, {'workerReplicas': 33}, {'postgres': 'both'}, {'valkey': 'disabled'},
                 {'DEV_AUTH': True}, {'appURL': 'http://public.example.edu'}, {'ocr': True},
                 {'ingress': True}, {'tracingSample': '1.1'}, {'runtimeSecret': 'bad/name'},
                 {'ingress': True, 'ingressClass': 'nginx', 'tlsSecret': 'tls', 'ingressHost': 'wrong.example.edu'}]
        for changes in cases:
            with self.subTest(changes=changes):
                v = values(); v.update(changes)
                self.assertNotEqual(helm(v, success=False).returncode, 0)
        print(f'{len(cases)} schema/template negatives rejected')

    def test_secret_preflight_contract(self):
        from preflight import check
        v = values()
        runtime = dict(DATABASE_URL='postgres://u:p@grounded-postgres:5432/db?sslmode=verify-full',
                       VALKEY_URL='rediss://:p@grounded-valkey:6379/0', ENCRYPTION_KEY='fixture', API_KEY_PEPPER='fixture')
        s3 = dict(access_key='fixture', secret_key='fixture')
        check(v, runtime, s3, {'SMTP_HOST': 'mail.example.org'})
        with self.assertRaises(ValueError): check(v, runtime, s3, {'DATABASE_URL': 'override'})
        with self.assertRaises(ValueError): check(v, dict(runtime, LOG_LEVEL='debug'), s3, owned_keys={'LOG_LEVEL'})
        for change in ({'DATABASE_URL': runtime['DATABASE_URL'].replace('verify-full', 'disable')},
                       {'VALKEY_URL': runtime['VALKEY_URL'].replace('rediss', 'redis')},
                       {'VALKEY_URL': runtime['VALKEY_URL'] + '?skip_verify=true'},
                       {'DATABASE_URL': runtime['DATABASE_URL'].replace('5432', '5433')},
                       {'DEV_AUTH': 'true'}, {'API_KEY_PEPPER': ''}):
            with self.assertRaises(ValueError): check(v, dict(runtime, **change), s3)

    def test_external_destinations(self):
        for managed in (False, True):
            v = values()
            for role, port in [('postgres', 25432), ('valkey', 26379)]:
                v[role + 'Destination'] = dict(host=role + '.db.example.org', port=port,
                    **({'cidr': '10.24.8.19/32'} if managed else
                       {'namespace': 'databases', 'podLabels': {'service': role}}))
            raw = helm(v).stdout
            self.assertEqual(semantic(raw), semantic(oracle(v)))
            objects = list(yaml.safe_load_all(raw))
            self.assertFalse(any(o and o['kind'] == 'StatefulSet' for o in objects))
            self.assertNotEqual(semantic(raw), semantic(raw.replace('25432', '5432')))
            self.assertNotEqual(semantic(raw), semantic(raw.replace('10.24.8.19/32', '10.24.8.20/32')
                if managed else raw.replace('"service":"postgres"', '"service":"wrong"')))
            r = subprocess.run([os.getenv('KUBECONFORM', 'kubeconform'), '-strict', '-summary',
                '-kubernetes-version', '1.34.0'], input=raw, text=True, capture_output=True, timeout=90)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        base = dict(host='db.example.org', port=25432, cidr='10.24.8.19/32')
        for dest in ({}, dict(base, cidr='0.0.0.0/0'), dict(base, cidr='999.1.1.1/32'), dict(base, cidr='224.0.0.1/32'),
                     dict(base, port=443), dict(base, port=9000), dict(base, namespace='db'),
                     dict(host='db', port=5432, namespace='db', podLabels={}),
                     dict(host='db', port=5432, namespace='db', podLabels={'.bad/key': 'value'})):
            v = values(); v['postgresDestination'] = dest
            self.assertNotEqual(helm(v, success=False).returncode, 0)
        v = values(); v['postgres'] = 'bundled'
        self.assertNotEqual(helm(v, success=False).returncode, 0)

    def test_comparator_mutation(self):
        raw = helm(values()).stdout
        mutated = raw.replace('allowPrivilegeEscalation: false', 'allowPrivilegeEscalation: true', 1)
        self.assertNotEqual(semantic(raw), semantic(mutated))
        with self.assertRaises(AssertionError):
            semantic(raw.replace('name: grounded-config-', 'name: dangling-', 1))


if __name__ == '__main__':
    unittest.main(verbosity=2)
