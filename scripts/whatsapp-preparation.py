#!/usr/bin/python3
"""Preparation adapter: native WhatsApp evidence, restricted SQL and atomic writes."""
import argparse
import ctypes
import datetime
import hashlib
import json
import pathlib
import sqlite3
import sys

AGENT = 'doogy-food-prep'
GROUP = '120363380724268297@g.us'
DB = '/root/.openclaw/agents/doogy-food-prep/agent/openclaw-agent.sqlite'
CONFIG = '/etc/hot-doogy/whatsapp-preparation.json'
SENDERS = {'5527997692133', '17743297174', '17742742377', '15083717201',
           '17744779537', '17745400946', '17743464220', '17742314177'}


def decode_event(raw, compressed, size):
    if raw is not None:
        return json.loads(raw)
    if not size or not 0 < size <= 4194304:
        raise ValueError('Invalid source transcript size.')
    zstd = ctypes.CDLL('libzstd.so.1')
    zstd.ZSTD_decompress.restype = ctypes.c_size_t
    output = ctypes.create_string_buffer(size)
    if zstd.ZSTD_decompress(output, size, compressed, len(compressed)) != size:
        raise ValueError('Cannot verify source transcript.')
    return json.loads(output.raw)


def source_message(group, message_id, database=DB):
    if group != GROUP or not isinstance(message_id, str):
        raise ValueError('Unauthorized preparation source.')
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as db:
        rows = db.execute('''select e.event_json,e.event_zstd,e.event_utf8_bytes
          from transcript_events e join session_windows w on w.session_id=e.session_id
          where w.session_key=? order by e.created_at desc''',
                          (f'agent:{AGENT}:whatsapp:group:{group}',))
        for row in rows:
            message = decode_event(*row).get('message', {})
            meta = message.get('__openclaw', {})
            transport = meta.get('transport', {})
            if message.get('role') != 'user' or transport.get('channel') != 'whatsapp' or transport.get('messageId') != message_id:
                continue
            conversation = db.execute('select peer_id,channel,kind from conversations where conversation_id=?',
                                      (transport.get('conversationRef'),)).fetchone()
            sender = str(meta.get('senderId', '')).split('@')[0].lstrip('+')
            if conversation != (group, 'whatsapp', 'group') or sender not in SENDERS:
                raise ValueError('Source conversation or sender is not authorized.')
            return message
    raise ValueError('Original message not found in preparation agent transcript.')


def has_image(message):
    # User text saying "photo attached" is not attachment evidence.
    content = message.get('content', [])
    return isinstance(content, list) and any(isinstance(part, dict) and part.get('type') in
                                            ('image', 'image_url', 'input_image') for part in content)


def prepare(payload, database=DB):
    allowed = {'groupId', 'messageId', 'kind', 'step', 'data', 'photoMessageIds'}
    if not isinstance(payload, dict) or set(payload) - allowed or not isinstance(payload.get('data'), dict):
        raise ValueError('Unsupported preparation payload.')
    source = source_message(payload.get('groupId'), payload.get('messageId'), database)
    photos = payload.get('photoMessageIds', [])
    if not isinstance(photos, list) or len(photos) > 10 or any(not isinstance(p, str) for p in photos) or len(set(photos)) != len(photos):
        raise ValueError('Invalid photo references.')
    evidence = [source]
    for message_id in sorted(photos):
        photo = source_message(payload['groupId'], message_id, database)
        if not has_image(photo) or abs(photo['timestamp'] - source['timestamp']) > 86400000:
            raise ValueError('Preparation photo evidence missing or too distant from source.')
        evidence.append(photo)
    if payload.get('kind') == 'production':
        if payload.get('step') is not None or not any(has_image(m) for m in evidence):
            raise ValueError('Production requires a preparation photo, not a label photo requirement.')
        fields = {'itemId', 'itemUnitId', 'qty', 'actualQty', 'recipeVersionId', 'areaId', 'preparedTeamMemberId', 'notes'}
        if set(payload['data']) - fields:
            raise ValueError('Unsupported production data field.')
    elif payload.get('kind') == 'transfer':
        fields = {
            'create': {'requesting_location_id', 'fulfilling_location_id', 'needed_on', 'notes', 'lines'},
            'approve': {'request_id', 'lines'},
            'dispatch': {'request_id', 'notes', 'lines'},
            'receive': {'request_id', 'transfer_id', 'notes', 'lines'},
        }
        if payload.get('step') not in fields or set(payload['data']) - fields[payload['step']]:
            raise ValueError('Unsupported transfer step or data field.')
    else:
        raise ValueError('Unsupported preparation operation.')
    result = {key: value for key, value in payload.items() if key != 'photoMessageIds'}
    result['agentId'] = AGENT
    result['occurredAt'] = datetime.datetime.fromtimestamp(source['timestamp'] / 1000, datetime.timezone.utc).isoformat()
    result['sourceSha256'] = hashlib.sha256(json.dumps(evidence, ensure_ascii=False, sort_keys=True,
                                                     separators=(',', ':')).encode()).hexdigest()
    return result


def execute(payload, config, check=False, connect=None):
    if connect is None:
        import psycopg2
        connect = psycopg2.connect
    with connect(**config, connect_timeout=15, application_name='doogy-whatsapp-preparation') as db:
        with db.cursor() as cur:
            cur.execute("set local statement_timeout='20s'; set local lock_timeout='10s'")
            statement = 'select doogy_operations.record_whatsapp_preparation(%s::jsonb)'
            cur.execute(statement, (json.dumps(payload),))
            result = cur.fetchone()[0]
            cur.execute(statement, (json.dumps(payload),))
            if cur.fetchone()[0] != result:
                raise ValueError('Preparation persistence verification failed.')
        if check:
            db.rollback()
            return {'validated': True, 'committed': False, 'id': result['id'] if 'id' in result else result['request_id']}
    return dict(result, committed=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--input', help='Private JSON containing native source references and validated operation')
    mode.add_argument('--catalog', action='store_true', help='Read only Batch Prep items, recipes, units, areas and team')
    parser.add_argument('--check', action='store_true', help='Execute and verify the transaction, then roll back')
    args = parser.parse_args()
    config = json.loads(pathlib.Path(CONFIG).read_text())
    if args.catalog:
        import psycopg2
        with psycopg2.connect(**config, connect_timeout=15, application_name='doogy-preparation-catalog') as db:
            with db.cursor() as cur:
                cur.execute("set local statement_timeout='20s'")
                cur.execute('select doogy_operations.preparation_catalog()')
                result = cur.fetchone()[0]
    else:
        payload = prepare(json.loads(pathlib.Path(args.input).read_text()))
        result = execute(payload, config, args.check)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not expose DSNs, credentials, arbitrary PostgreSQL DETAIL or source photos.
        print(json.dumps({'recorded': False, 'errorType': type(error).__name__,
                          'databaseCode': getattr(error, 'pgcode', None),
                          'message': str(error) if isinstance(error, ValueError) else
                          'Preparation adapter failed. Check source evidence and database validation.'}), file=sys.stderr)
        sys.exit(1)
