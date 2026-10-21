#!/usr/bin/python3
"""Restricted WhatsApp waste adapter. Secrets remain in a private server file."""
import argparse
import ctypes
import datetime
import hashlib
import json
import pathlib
import sqlite3
import sys

GROUPS = {'120363311370740378@g.us', '120363402354455463@g.us'}
AGENT = 'doogy-waste-tracking'
DB = '/root/.openclaw/agents/doogy-waste-tracking/agent/openclaw-agent.sqlite'
CONFIG = '/etc/hot-doogy/whatsapp-waste.json'


def decode_event(raw, compressed, size):
    if raw is not None:
        return json.loads(raw)
    if not size or size > 4194304:
        raise ValueError('Invalid source transcript size.')
    zstd = ctypes.CDLL('libzstd.so.1')
    zstd.ZSTD_decompress.restype = ctypes.c_size_t
    output = ctypes.create_string_buffer(size)
    if zstd.ZSTD_decompress(output, size, compressed, len(compressed)) != size:
        raise ValueError('Cannot verify source transcript.')
    return json.loads(output.raw)


def source_message(group, message_id, database=DB):
    if group not in GROUPS:
        raise ValueError('Unauthorized source group.')
    key = f'agent:{AGENT}:whatsapp:group:{group}'
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as db:
        rows = db.execute('''select e.event_json,e.event_zstd,e.event_utf8_bytes
          from transcript_events e join session_windows w on w.session_id=e.session_id
          where w.session_key=? order by e.created_at desc''', (key,))
        for row in rows:
            message = decode_event(*row).get('message', {})
            meta = message.get('__openclaw', {})
            transport = meta.get('transport', {})
            if message.get('role') != 'user' or transport.get('channel') != 'whatsapp' or transport.get('messageId') != message_id:
                continue
            # Conversation metadata, not user-supplied text, must match the group.
            conv = db.execute('select peer_id,channel,kind from conversations where conversation_id=?', (transport.get('conversationRef'),)).fetchone()
            if conv != (group, 'whatsapp', 'group') or not meta.get('senderId'):
                raise ValueError('Source conversation or sender is not verified.')
            return message
    raise ValueError('Original WhatsApp message not found in this agent/group transcript.')


def prepare(payload, database=DB):
    allowed = {'groupId', 'messageId', 'teamMemberId', 'reason', 'notes', 'lines'}
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise ValueError('Unsupported waste payload field.')
    source = source_message(payload.get('groupId'), payload.get('messageId'), database)
    # The source timestamp and digest are derived locally, never supplied by the model.
    result = dict(payload)
    result['agentId'] = AGENT
    result['occurredAt'] = datetime.datetime.fromtimestamp(source['timestamp'] / 1000, datetime.timezone.utc).isoformat()
    result['sourceSha256'] = hashlib.sha256(json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return result


def execute(payload, config, check=False):
    import psycopg2
    with psycopg2.connect(**config, connect_timeout=15, application_name='doogy-whatsapp-waste') as db:
        with db.cursor() as cur:
            cur.execute("set local statement_timeout='20s'; set local lock_timeout='10s'")
            cur.execute('select doogy_operations.record_whatsapp_waste(%s::jsonb)', (json.dumps(payload),))
            result = cur.fetchone()[0]
            # Retry inside the same transaction proves the durable key returns the same event.
            cur.execute('select doogy_operations.record_whatsapp_waste(%s::jsonb)', (json.dumps(payload),))
            if cur.fetchone()[0] != result:
                raise ValueError('Waste verification failed.')
        if check:
            db.rollback()
            return {'validated': True, 'committed': False, 'lineCount': len(result['movements']), 'locationId': result['locationId']}
    return dict(result, committed=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='JSON file containing source group/message, reporter and verified waste lines')
    parser.add_argument('--check', action='store_true', help='Exercise the full transaction and roll it back')
    args = parser.parse_args()
    payload = prepare(json.loads(pathlib.Path(args.input).read_text()))
    config = json.loads(pathlib.Path(CONFIG).read_text())
    print(json.dumps(execute(payload, config, args.check), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print DSNs, passwords, arbitrary database DETAIL or server environment.
        print(json.dumps({'recorded': False, 'errorType': type(error).__name__, 'databaseCode': getattr(error, 'pgcode', None), 'message': str(error) if isinstance(error, ValueError) else 'Waste adapter failed. Check source data and database validation.'}), file=sys.stderr)
        sys.exit(1)
