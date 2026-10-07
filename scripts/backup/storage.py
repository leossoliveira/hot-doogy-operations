#!/usr/bin/env python3
"""Read-only Storage export. Object keys are data, never local paths."""
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

PROJECT = 'kfnsfnytnnpwptklmbip'


def load_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def client(path):
    import boto3
    from botocore.config import Config
    env = load_env(path)
    url = urlparse(env['SUPABASE_S3_ENDPOINT'])
    if (url.scheme != 'https' or url.hostname not in
            [f'{PROJECT}.supabase.co', f'{PROJECT}.storage.supabase.co'] or
            url.path.rstrip('/') != '/storage/v1/s3' or
            url.username or url.password or url.port or url.query or url.fragment):
        raise ValueError('Unexpected Storage endpoint')
    return boto3.client('s3', endpoint_url=env['SUPABASE_S3_ENDPOINT'],
                        region_name=env['SUPABASE_S3_REGION'],
                        aws_access_key_id=env['SUPABASE_S3_ACCESS_KEY_ID'],
                        aws_secret_access_key=env['SUPABASE_S3_SECRET_ACCESS_KEY'],
                        config=Config(signature_version='s3v4',
                                      s3={'addressing_style': 'path'},
                                      connect_timeout=15, read_timeout=60,
                                      retries={'max_attempts': 3}))


def inventory(s3):
    buckets = sorted(b['Name'] for b in s3.list_buckets()['Buckets'])
    entries = []
    for bucket in buckets:
        for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket):
            for obj in page.get('Contents', []):
                entries.append({'bucket': bucket, 'key': obj['Key'],
                                'size': obj['Size'], 'etag': obj['ETag'],
                                'last_modified': obj['LastModified'].isoformat()})
    return {'buckets': buckets, 'objects': sorted(entries, key=lambda x: (x['bucket'], x['key']))}


def export(s3, destination):
    destination = Path(destination)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    (destination / 'objects').mkdir(mode=0o700)
    before = inventory(s3)
    manifest = {'format': 1, 'project': PROJECT, 'buckets': before['buckets'], 'objects': []}
    for item in before['objects']:
        token = hashlib.sha256(json.dumps([item['bucket'], item['key']]).encode()).hexdigest()
        relative = f'objects/{token}'
        response = s3.get_object(Bucket=item['bucket'], Key=item['key'], IfMatch=item['etag'])
        digest = hashlib.sha256()
        size = 0
        with (destination / relative).open('xb') as file:
            try:
                for chunk in response['Body'].iter_chunks(chunk_size=1024 * 1024):
                    file.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
            finally:
                response['Body'].close()
        if size != item['size'] or response['ETag'] != item['etag']:
            raise ValueError('Object changed during export')
        metadata = {k: response[k] for k in
                    ['ContentType', 'CacheControl', 'ContentDisposition', 'ContentEncoding',
                     'ContentLanguage', 'Metadata'] if k in response}
        manifest['objects'].append({**item, 'file': relative, 'sha256': digest.hexdigest(),
                                    'headers': metadata})
    if inventory(s3) != before:
        raise ValueError('Storage changed during export; retry for a stable snapshot')
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return len(manifest['objects']), sum(x['size'] for x in manifest['objects'])


def verify(destination):
    destination = Path(destination).resolve()
    manifest = json.loads((destination / 'manifest.json').read_text())
    for item in manifest['objects']:
        file = (destination / item['file']).resolve()
        if destination not in file.parents or not file.is_file():
            raise ValueError('Unsafe or missing restored object')
        digest = hashlib.sha256()
        with file.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        if file.stat().st_size != item['size'] or digest.hexdigest() != item['sha256']:
            raise ValueError('Restored object integrity mismatch')
    return len(manifest['objects'])
