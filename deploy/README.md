# Hospedagem na VPS

O aplicativo executa como o usuário restrito `hotdoogy`, no serviço `hot-doogy`, escutando apenas em `127.0.0.1:4173`. Reinicia automaticamente em caso de falha e na inicialização da VPS. O Nginx publica https://management.hotdoogy.com com certificado válido e uma senha adicional antes do login individual.

## Subdomínio e HTTPS

O registro DNS `A management` em `hotdoogy.com` aponta para `2.24.118.177`, com TTL 300. O site principal, os pedidos e o e-mail usam registros separados.

- Configuração Nginx: `/etc/nginx/sites-available/hot-doogy-management`, ligada em `sites-enabled`.
- Modelo versionado: `deploy/nginx-management.conf`.
- Usuário da proteção adicional: `management`.
- Hash da senha: `/etc/nginx/hot-doogy.htpasswd`, permissão 640, proprietário root e grupo www-data. A senha e seu hash não devem ir para o GitHub.
- Certificado: `/etc/letsencrypt/live/management.hotdoogy.com/`.
- Renovação: `certbot.timer`, com `deploy/renew-certificate-hook.sh` instalado em `/etc/letsencrypt/renewal-hooks/deploy/hot-doogy-nginx`.
- A porta 80 redireciona para HTTPS. Somente a verificação ACME do certificado é atendida diretamente em `/var/www/hot-doogy-acme`.

O proxy exige a senha para páginas, arquivos e APIs. Ele verifica a origem pública antes de encaminhar alterações ao servidor local, remove a credencial Basic antes de encaminhar a requisição e aplica `Secure`, `HttpOnly` e `SameSite=Strict` ao cookie da aplicação. O login individual e as permissões do Supabase continuam obrigatórios. A senha de entrada é compartilhada e não substitui as contas individuais.

Para reconstruir o HTTPS em outra VPS:

1. Instale `nginx`, `apache2-utils` e `certbot`; configure o DNS para a nova VPS.
2. Crie `/var/www/hot-doogy-acme` e ative primeiro `nginx-management-bootstrap.conf` no Nginx. Esse arquivo atende apenas o desafio do certificado e redireciona as demais requisições.
3. Emita o certificado com `certbot certonly --webroot -w /var/www/hot-doogy-acme -d management.hotdoogy.com`, seguindo os prompts de cadastro.
4. Crie a proteção com `htpasswd -cB -C 10 /etc/nginx/hot-doogy.htpasswd management` e forneça a senha no terminal. Ajuste o proprietário para `root:www-data` e a permissão para 640. Use `-c` somente para criar o arquivo inicial, pois essa opção substitui um arquivo existente.
5. Substitua a configuração inicial por `nginx-management.conf`, valide com `nginx -t` e recarregue o Nginx.
6. Instale o hook de renovação com permissão 755, habilite `certbot.timer` e valide com `certbot renew --cert-name management.hotdoogy.com --dry-run`.

## Atualizações

A cada aproximadamente dois minutos, `hot-doogy-update.timer` busca tags `v0.1.N` do repositório privado. Essas tags são criadas pelo GitHub após os testes de `main`. A VPS usa uma chave de implantação com leitura apenas deste repositório; não pode enviar alterações ao GitHub.

O atualizador escolhe a versão numericamente mais recente que pertença ao histórico de `main`, executa novamente a verificação de sintaxe e os testes sem privilégios de root, troca o diretório ativo e reinicia o serviço. Se o teste de disponibilidade falhar, restaura o diretório anterior. As versões anteriores ficam em `/opt/hot-doogy/releases`.

Alterações locais continuam exigindo autorização antes do envio ao GitHub. Uma vez enviada e aprovada nos testes, a versão é instalada automaticamente na VPS. Reiniciar o aplicativo encerra as sessões em memória: os usuários precisam entrar novamente. O banco permanece no Supabase.

## Instalar em outra VPS sem arquivos do Mac

Requer Linux com systemd, Node.js 24 ou superior em `/usr/bin/node`, npm, Git, OpenSSH, curl e util-linux. O projeto Supabase existente precisa permanecer ativo; estas instruções reinstalam o aplicativo, não recriam o banco de dados.

1. No novo servidor, crie `/etc/hot-doogy` com permissão 700 e gere uma chave SSH exclusiva em `/etc/hot-doogy/github_deploy_key`. Cadastre somente a chave pública como **Deploy key de leitura** em `leossoliveira/hot-doogy-operations`. Não copie chaves pessoais nem dê permissão de escrita.
2. Configure a identidade SSH do GitHub usando [a chave pública oficial](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). Clone o repositório com essa chave de implantação e a verificação de host habilitada.
3. Use `deploy/supabase-s3.env.example` como modelo para `/etc/hot-doogy/supabase-s3.env`. Obtenha as credenciais S3 do projeto Supabase ou do cofre de segredos da operação. Proteja o arquivo com permissão 600 até a instalação. Não envie o arquivo preenchido ao GitHub.
4. Na pasta clonada, execute como root `bash deploy/install.sh`. O instalador configura as permissões, instala os serviços e baixa a versão aprovada diretamente do GitHub. Ele não requer exportações, imagens originais, backups ou outras pastas do Mac.

A configuração S3 existente já está na VPS atual. Mantenha uma cópia das credenciais em um cofre de segredos ou um procedimento para recriá-las no Supabase. O GitHub é o backup do código, não das credenciais nem do banco.

## Acesso de manutenção por túnel

O acesso normal é https://management.hotdoogy.com e não requer Terminal. O túnel abaixo é apenas uma alternativa administrativa para acesso direto ao serviço local da VPS; exige autenticação SSH na VPS.

No computador, abra um túnel e mantenha-o conectado:

```sh
ssh -L 4173:127.0.0.1:4173 root@2.24.118.177
```

Abra http://127.0.0.1:4173 no navegador. A porta 4173 do computador precisa estar livre. O aplicativo roda na VPS; o túnel só transporta o acesso.

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


## Endurecimento aplicado em 5 de outubro de 2026

- Firewall UFW ativo em IPv4/IPv6: entrada somente TCP 22, 80 e 443; saída liberada. RDP 3389 é acessível apenas localmente/por túnel SSH.
- `/etc/ssh/sshd_config.d/00-hot-doogy-hardening.conf` corresponde a `sshd-hardening.conf`. Senhas e keyboard-interactive estão desativados; root conserva acesso por chave para compatibilidade com integrações existentes. Uma nova conexão por chave foi validada antes e depois da mudança. Preferir usuário nominal e sudo em uma próxima etapa.
- Antes de alterar SSH/firewall novamente, valide uma segunda sessão e mantenha recuperação pelo console da Hostinger. Backups desta alteração estão em `/root/hot-doogy-security-20261005`.
- Nginx limita requisições por IP e impõe orçamento adicional ao endpoint de login, inclusive antes do Basic Auth.
- A correção de limite da aplicação depende de `HOT_DOOGY_TRUST_PROXY=loopback` no serviço. O Nginx sobrescreve `X-Real-IP`; a aplicação só confia nele quando o peer é loopback e a opção está habilitada. Nunca exponha a porta Node diretamente.
- Para instalar esta configuração de serviço após publicar a correção do login, instale `hot-doogy.service` em `/etc/systemd/system/`, execute `systemctl daemon-reload` e reinicie `hot-doogy`. A simples atualização do código não reinstala arquivos de systemd.
- `database/security-anonymous-access.sql` registra a migração já aplicada `security_revoke_unnecessary_anonymous_access`; não é necessário reaplicá-la para publicar a correção do login.

A senha adicional do subdomínio foi mantida. Essas correções não significam aprovação integral do checklist: MFA administrativo, proteção da branch, scanners de segurança, validação completa de uploads e restauração de backup ainda precisam de conclusão.
