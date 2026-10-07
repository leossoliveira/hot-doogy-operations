#!/bin/zsh
printf '\033]0;VPS SSH\007'
printf 'Conectando à VPS 2.24.118.177...\n'
/usr/bin/ssh -F /dev/null -i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes -o IdentityAgent=none -o UseKeychain=no -o AddKeysToAgent=no -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o ControlMaster=no -o ControlPath=none -o ServerAliveInterval=30 -o ServerAliveCountMax=3 root@2.24.118.177
printf '\nConexão encerrada. Pressione Enter para fechar.'
read -r
