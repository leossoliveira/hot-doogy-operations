# Hospedagem na VPS

O aplicativo executa como o usuário restrito `hotdoogy`, no serviço `hot-doogy`, escutando apenas em `127.0.0.1:4173`. Reinicia automaticamente em caso de falha e na inicialização da VPS. Não há domínio ou porta HTTP pública configurada nesta etapa.

## Atualizações

A cada aproximadamente dois minutos, `hot-doogy-update.timer` busca tags `v0.1.N` do repositório privado. Essas tags são criadas pelo GitHub após os testes de `main`. A VPS usa uma chave de implantação com leitura apenas deste repositório; não pode enviar alterações ao GitHub.

O atualizador escolhe a versão numericamente mais recente que pertença ao histórico de `main`, executa novamente a verificação de sintaxe e os testes sem privilégios de root, troca o diretório ativo e reinicia o serviço. Se o teste de disponibilidade falhar, restaura o diretório anterior. As versões anteriores ficam em `/opt/hot-doogy/releases`.

Alterações locais continuam exigindo autorização antes do envio ao GitHub. Uma vez enviada e aprovada nos testes, a versão é instalada automaticamente na VPS. Reiniciar o aplicativo encerra as sessões em memória: os usuários precisam entrar novamente. O banco permanece no Supabase.

## Acesso temporário

No computador, abra um túnel e mantenha-o conectado:

```sh
ssh -L 4173:127.0.0.1:4173 root@2.24.118.177
```

Abra http://127.0.0.1:4173 no navegador. A porta 4173 do computador precisa estar livre. O aplicativo roda na VPS; o túnel só transporta o acesso. Para acesso independente do túnel, a próxima etapa é configurar o subdomínio e HTTPS.

## Arquivos e manutenção

- Código ativo: `/opt/hot-doogy/current`.
- Versão instalada: `/opt/hot-doogy/deployed-version`.
- Repositório espelhado: `/var/lib/hot-doogy/repository.git`.
- Armazenamento: `/etc/hot-doogy/supabase-s3.env`, fora do Git e legível somente por root e pelo grupo do serviço.
- Chave de leitura do GitHub: `/etc/hot-doogy/github_deploy_key`, acessível somente por root.
- Atualizador instalado: `/usr/local/sbin/hot-doogy-update`.

```sh
systemctl status hot-doogy hot-doogy-update.timer
journalctl -u hot-doogy -n 50 --no-pager
journalctl -u hot-doogy-update -n 50 --no-pager
systemctl start hot-doogy-update
```

Os arquivos desta pasta documentam os serviços instalados. Alterá-los no GitHub não modifica automaticamente os serviços do sistema nem o atualizador: a reinstalação desses arquivos é uma operação administrativa separada.
