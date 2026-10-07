import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts' / 'backup'))
from storage import export, verify


class Body(io.BytesIO):
    def iter_chunks(self, chunk_size):
        while True:
            part = self.read(chunk_size)
            if not part:
                break
            yield part


class Storage:
    def __init__(self, changing=False, wrong_size=False):
        self.round = 0
        self.changing = changing
        self.wrong_size = wrong_size

    def list_buckets(self):
        self.round += 1
        return {'Buckets': [{'Name': 'private'}, {'Name': 'empty'}]}

    def get_paginator(self, operation):
        assert operation == 'list_objects_v2'
        return self

    def paginate(self, Bucket):
        if Bucket == 'empty':
            yield {}
        else:
            for key in ['../../outside', 'folder/photo é.png']:
                yield {'Contents': [{'Key': key, 'ETag': 'new' if self.changing and self.round > 1 else 'etag',
                                     'Size': 4 if self.wrong_size else 3,
                                     'LastModified': datetime(2026, 1, 1, tzinfo=timezone.utc)}]}

    def get_object(self, **kwargs):
        assert kwargs['IfMatch'] == 'etag'
        return {'Body': Body(b'abc'), 'ETag': 'etag', 'ContentType': 'image/png'}


class BackupTests(unittest.TestCase):
    def test_pages_empty_buckets_and_untrusted_object_paths(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'snapshot'
            self.assertEqual(export(Storage(), dest), (2, 6))
            self.assertEqual(verify(dest), 2)
            self.assertFalse((Path(root) / 'outside').exists())
            manifest = json.loads((dest / 'manifest.json').read_text())
            self.assertEqual(manifest['buckets'], ['empty', 'private'])
            self.assertEqual(manifest['objects'][0]['sha256'], hashlib.sha256(b'abc').hexdigest())

    def test_concurrent_change_does_not_publish_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'snapshot'
            with self.assertRaises(ValueError):
                export(Storage(changing=True), dest)
            self.assertFalse((dest / 'manifest.json').exists())

    def test_incomplete_object_does_not_publish_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'snapshot'
            with self.assertRaises(ValueError):
                export(Storage(wrong_size=True), dest)
            self.assertFalse((dest / 'manifest.json').exists())

    def test_corruption_is_detected_after_restore(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'snapshot'
            export(Storage(), dest)
            next((dest / 'objects').iterdir()).write_bytes(b'xyz')
            with self.assertRaises(ValueError):
                verify(dest)


if __name__ == '__main__':
    unittest.main()
