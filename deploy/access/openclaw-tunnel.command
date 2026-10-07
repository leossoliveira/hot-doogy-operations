#!/bin/zsh
printf '\033]0;Túnel SSH OpenClaw\007'
printf 'Abrindo túnel OpenClaw para a VPS 2.24.118.177...\n'
printf 'Após autenticar, acesse http://127.0.0.1:18789 no navegador.\n'
printf 'Mantenha esta janela aberta. Para encerrar o túnel, pressione Ctrl+C.\n\n'
/usr/bin/ssh -F /dev/null -i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes -o IdentityAgent=none -o UseKeychain=no -o AddKeysToAgent=no -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o ControlMaster=no -o ControlPath=none -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18789:127.0.0.1:18789 root@2.24.118.177
printf '\nTúnel encerrado. Pressione Enter para fechar.'
read -r
