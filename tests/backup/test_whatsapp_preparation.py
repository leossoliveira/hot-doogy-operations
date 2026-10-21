import importlib.util
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('whatsapp_preparation', pathlib.Path(__file__).parents[2] / 'scripts/whatsapp-preparation.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def native_database(path, payload, image=True, sender='+17744779537'):
    message = {'role': 'user', 'timestamp': 1767268800000,
               'content': [{'type': 'text', 'text': 'Synthetic Prep / 3 units / Synthetic Cook'}],
               '__openclaw': {'senderId': sender, 'transport': {'channel': 'whatsapp',
                    'messageId': payload['messageId'], 'conversationRef': 'synthetic'}}}
    if image:
        message['content'].append({'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': 'synthetic'}})
    with sqlite3.connect(path) as db:
        db.executescript('create table session_windows(session_id text,session_key text);create table transcript_events(session_id text,event_json text,event_zstd blob,event_utf8_bytes int,created_at int);create table conversations(conversation_id text,peer_id text,channel text,kind text);')
        db.execute('insert into session_windows values(?,?)', ('s', f'agent:{adapter.AGENT}:whatsapp:group:{adapter.GROUP}'))
        db.execute('insert into conversations values(?,?,?,?)', ('synthetic', adapter.GROUP, 'whatsapp', 'group'))
        db.execute('insert into transcript_events values(?,?,null,null,1)', ('s', json.dumps({'message': message})))


def prepare_synthetic(payload):
    with tempfile.TemporaryDirectory() as tmp:
        path = str(pathlib.Path(tmp) / 'transcript.sqlite')
        native_database(path, payload)
        return adapter.prepare(payload, path)


class SourceVerification(unittest.TestCase):
    def payload(self):
        return {'groupId': adapter.GROUP, 'messageId': 'PREPTEST01', 'kind': 'production', 'data': {'qty': 3}}

    def test_native_source_and_photo_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(pathlib.Path(tmp) / 'transcript.sqlite')
            payload = self.payload()
            native_database(path, payload)
            result = adapter.prepare(payload, path)
            self.assertEqual(result['agentId'], adapter.AGENT)
            self.assertEqual(result['occurredAt'], '2026-01-01T12:00:00+00:00')
            self.assertEqual(len(result['sourceSha256']), 64)
            self.assertEqual(adapter.prepare(payload, path), result)
            for patch in [{'groupId': 'another-group'}, {'messageId': 'MISSING01'}, {'agentId': 'main'},
                          {'sourceSha256': 'a' * 64}, {'occurredAt': '2026-01-01'}, {'kind': 'waste'},
                          {'data': {'locationId': 'fake'}}, {'data': {'completedAt': '2026-01-01'}},
                          {'photoMessageIds': ['missing-photo']}, {'step': 'create'}]:
                with self.assertRaises(ValueError):
                    adapter.prepare(dict(payload, **patch), path)
            with sqlite3.connect(path) as db:
                db.execute("update conversations set peer_id='other-group'")
            with self.assertRaises(ValueError):
                adapter.prepare(payload, path)

    def test_text_cannot_forge_photo_and_unknown_sender_is_rejected(self):
        for image, sender in [(False, '+17744779537'), (True, '+10000000000')]:
            with tempfile.TemporaryDirectory() as tmp:
                path = str(pathlib.Path(tmp) / 'transcript.sqlite')
                payload = self.payload()
                native_database(path, payload, image=image, sender=sender)
                with self.assertRaises(ValueError):
                    adapter.prepare(payload, path)

    def test_commit_failure_never_returns_success_and_check_rolls_back(self):
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def execute(self, *args):
                pass

            def fetchone(self):
                return ({'id': 'synthetic-id', 'saved': True},)

        class Connection:
            rolled_back = False

            def __init__(self, fail=False):
                self.fail = fail

            def __enter__(self):
                return self

            def cursor(self):
                return Cursor()

            def rollback(self):
                self.rolled_back = True

            def __exit__(self, *args):
                if self.fail:
                    raise RuntimeError('Synthetic commit failure')
                return False

        with self.assertRaises(RuntimeError):
            adapter.execute({}, {}, connect=lambda **kwargs: Connection(fail=True))
        connection = Connection()
        self.assertFalse(adapter.execute({}, {}, check=True, connect=lambda **kwargs: connection)['committed'])
        self.assertTrue(connection.rolled_back)
        self.assertTrue(adapter.execute({}, {}, connect=lambda **kwargs: Connection())['committed'])


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--prepare':
        print(json.dumps(prepare_synthetic(json.loads(sys.argv[2]))))
    else:
        unittest.main()
