#!/usr/bin/env python3
"""Archive committed application source; never copy secrets or untracked exports."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])
commit = git('rev-parse', 'HEAD').decode().strip()
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
folder = root.parent / 'backups' / f'{stamp}-{commit[:12]}'
folder.mkdir(mode=0o700, parents=True, exist_ok=False)
archive = folder / 'app.zip'
archive.write_bytes(git('archive', '--format=zip', '--prefix=app/', commit))
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    tracked = git('ls-tree', '-r', '--name-only', '-z', commit).decode().split('\0')
    for name in filter(None, tracked):
        assert bundle.read('app/' + name) == git('show', f'{commit}:{name}')
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
(folder / 'SHA256.txt').write_text(f'{sha}  app.zip\n')
(folder / 'manifest.json').write_text(json.dumps({
    'commit': commit, 'created_at_utc': stamp, 'sha256': sha,
    'source': 'git archive HEAD', 'includes': 'committed source only',
    'excludes': ['uncommitted changes', 'Git history', 'database records', 'private storage', 'credentials'],
    'working_tree_status': git('status', '--porcelain').decode().splitlines(),
}, indent=2) + '\n')
for file in folder.iterdir():
    file.chmod(0o600)
print(f'Verified backup: {folder}')
print('Only committed files were archived. Uncommitted changes are listed in manifest.json.')
