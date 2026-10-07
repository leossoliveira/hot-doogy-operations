"""Offline failure tests: never contact production or read credentials."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts/backup'
sys.path.insert(0, str(SCRIPTS))

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SCRIPTS / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class DatabaseFailures(unittest.TestCase):
    def check_failure(self, failure):
        module = load('run-database')
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            previous = state / 'database-last-success.json'
            previous.write_text('{"snapshot":"previous"}')
            def export(destination):
                destination.mkdir()
                (destination / 'database.dump').write_bytes(b'partial private data')
                if failure == 'export':
                    raise RuntimeError('private details must not appear')
                return {'files': {'database.dump': 'invalid'}, 'tables': 1, 'rows': 1}
            restic = Mock(side_effect=RuntimeError('private details must not appear'))
            old_umask = os.umask(0o077)
            try:
                with patch.object(module, 'STATE', state), patch.object(module, 'export', side_effect=export), patch.object(module, 'restic', restic), patch.object(module.shutil, 'disk_usage', return_value=SimpleNamespace(free=0 if failure == 'disk' else 2**32)), contextlib.redirect_stdout(io.StringIO()) as output:
                    with self.assertRaises(SystemExit):
                        module.run()
                self.assertEqual(json.loads(previous.read_text()), {'snapshot': 'previous'})
                self.assertEqual(json.loads((state / 'database-last-run.json').read_text())['status'], 'failed')
                self.assertNotIn('private details', output.getvalue())
                self.assertEqual(set(state.glob('database-*')), {previous, state / 'database-last-run.json'})
                if failure != 'restic':
                    restic.assert_not_called()
            finally:
                os.umask(old_umask)

    def test_export_failure(self): self.check_failure('export')
    def test_disk_full(self): self.check_failure('disk')
    def test_encryption_failure(self): self.check_failure('restic')

class ReplicaFailures(unittest.TestCase):
    def check_sync(self, manifest, transfer_failure=False, locked=True):
        module = load('sync-from-vps')
        lock = Mock(stdin=Mock(), stdout=io.StringIO('locked\n' if locked else ''))
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'restic'
            destination.mkdir()
            (destination / 'config').write_bytes(b'encrypted')
            with patch.object(module.subprocess, 'Popen', return_value=lock), patch.object(module.subprocess, 'run', side_effect=RuntimeError('transfer failed') if transfer_failure else None), patch.object(module.subprocess, 'check_output', return_value=json.dumps(manifest).encode()), contextlib.redirect_stdout(io.StringIO()) as output:
                try:
                    module.sync(Path('/unused-key'), destination)
                finally:
                    lock.stdin.close.assert_called_once()
                    lock.wait.assert_called_once_with(timeout=15)
            return output.getvalue()

    def test_transfer_failure_unlocks(self):
        with self.assertRaises(RuntimeError): self.check_sync({}, transfer_failure=True)
    def test_lock_failure(self):
        with self.assertRaises(RuntimeError): self.check_sync({}, locked=False)
    def test_unsafe_path(self):
        with self.assertRaises(ValueError): self.check_sync({'../outside': 'bad'})
    def test_checksum_failure(self):
        with self.assertRaises(ValueError): self.check_sync({'config': 'bad'})
    def test_empty_manifest(self):
        with self.assertRaises(ValueError): self.check_sync({})
    def test_verified_copy(self):
        self.assertIn('verified: 1 files', self.check_sync({'config': hashlib.sha256(b'encrypted').hexdigest()}))
