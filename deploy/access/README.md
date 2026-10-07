# macOS access shortcuts

- `vps-ssh.command`: interactive SSH session to the VPS.
- `openclaw-tunnel.command`: OpenClaw tunnel at http://127.0.0.1:18789. Keep its Terminal window open; press Ctrl+C to stop.

Double-click a shortcut in Finder. Both require the existing passphrase for `~/.ssh/id_ed25519` on every connection, bypassing SSH agent and Keychain reuse. The private key remains outside this repository; these shortcuts contain no password or private key. They work independently of the current directory.

Original Desktop shortcuts are preserved. These files are maintained copies, not automatically synchronized with the Desktop. An already-running session is unaffected.
