import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('whatsapp_waste', pathlib.Path(__file__).parents[2] / 'scripts/whatsapp-waste.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class SourceVerification(unittest.TestCase):
    def test_native_metadata_required_and_derived(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(pathlib.Path(tmp) / 'transcript.sqlite')
            group = '120363311370740378@g.us'
            message = {'role': 'user', 'timestamp': 1792553270000, 'content': 'Verified report', '__openclaw': {'senderId': '+10000000000', 'transport': {'channel': 'whatsapp', 'messageId': 'TESTMESSAGE01', 'conversationRef': 'conv1'}}}
            with sqlite3.connect(path) as db:
                db.executescript('create table session_windows(session_id text,session_key text);create table transcript_events(session_id text,event_json text,event_zstd blob,event_utf8_bytes int,created_at int);create table conversations(conversation_id text,peer_id text,channel text,kind text);')
                db.execute('insert into session_windows values(?,?)', ('s', f'agent:{adapter.AGENT}:whatsapp:group:{group}'))
                db.execute('insert into conversations values(?,?,?,?)', ('conv1', group, 'whatsapp', 'group'))
                db.execute('insert into transcript_events values(?,?,null,null,1)', ('s', json.dumps({'message': message})))
            payload = {'groupId': group, 'messageId': 'TESTMESSAGE01'}
            result = adapter.prepare(payload, path)
            self.assertEqual(result['occurredAt'], '2026-10-21T03:27:50+00:00')
            self.assertEqual(len(result['sourceSha256']), 64)
            self.assertEqual(adapter.prepare(payload, path), result)
            for patch in [{'groupId': '120363402354455463@g.us'}, {'messageId': 'MISSING01'}, {'agentId': 'main'}, {'occurredAt': '2026-01-01'}, {'locationId': 'fake'}]:
                with self.assertRaises(ValueError):
                    adapter.prepare(dict(payload, **patch), path)
            with sqlite3.connect(path) as db:
                db.execute("update conversations set peer_id='another-group'")
            with self.assertRaises(ValueError):
                adapter.prepare(payload, path)


if __name__ == '__main__':
    unittest.main()
