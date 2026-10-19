# Hospedagem na VPS

O aplicativo executa como o usuário restrito `hotdoogy`, no serviço `hot-doogy`, escutando apenas em `127.0.0.1:4173`. Reinicia automaticamente em caso de falha e na inicialização da VPS. O Nginx publica https://management.hotdoogy.com com certificado válido e acesso direto ao login individual, sem senha compartilhada do navegador.

## Subdomínio e HTTPS

O registro DNS `A management` em `hotdoogy.com` aponta para `2.24.118.177`, com TTL 300. O site principal, os pedidos e o e-mail usam registros separados.

- Configuração Nginx: `/etc/nginx/sites-available/hot-doogy-management`, ligada em `sites-enabled`.
- Modelo versionado: `deploy/nginx-management.conf`.
- A proteção Basic Auth está desativada (`auth_basic off`). O arquivo antigo de senha permanece somente na VPS, sem uso; seu conteúdo não deve ir para o GitHub.
- Certificado: `/etc/letsencrypt/live/management.hotdoogy.com/`.
- Renovação: `certbot.timer`, com `deploy/renew-certificate-hook.sh` instalado em `/etc/letsencrypt/renewal-hooks/deploy/hot-doogy-nginx`.
- A porta 80 redireciona para HTTPS. Somente a verificação ACME do certificado é atendida diretamente em `/var/www/hot-doogy-acme`.

O proxy permite abrir a tela de login sem uma senha adicional. Ele verifica a origem pública antes de encaminhar alterações ao servidor local, remove a credencial Basic antes de encaminhar a requisição e aplica `Secure`, `HttpOnly` e `SameSite=Strict` ao cookie da aplicação. O login individual e as permissões do Supabase continuam obrigatórios. As APIs protegidas continuam exigindo uma sessão autenticada; o MFA administrativo permanece obrigatório.

Para reconstruir o HTTPS em outra VPS:

1. Instale `nginx` e `certbot`; configure o DNS para a nova VPS.
2. Crie `/var/www/hot-doogy-acme` e ative primeiro `nginx-management-bootstrap.conf` no Nginx. Esse arquivo atende apenas o desafio do certificado e redireciona as demais requisições.
3. Emita o certificado com `certbot certonly --webroot -w /var/www/hot-doogy-acme -d management.hotdoogy.com`, seguindo os prompts de cadastro.
4. Substitua a configuração inicial por `nginx-management.conf`, valide com `nginx -t` e recarregue o Nginx.
5. Instale o hook de renovação com permissão 755, habilite `certbot.timer` e valide com `certbot renew --cert-name management.hotdoogy.com --dry-run`.

## Cloudflare - migração em 19 de outubro de 2026

A zona `hotdoogy.com` foi criada no plano Free, copiando os nove registros conferidos na Hostinger. O domínio raiz e `www` do Wix, `order`, `www.order`, `careers`, MX e TXT permanecem em Somente DNS. A troca para `roman.ns.cloudflare.com` e `stella.ns.cloudflare.com` foi concluída com verificação por e-mail e confirmada em 1.1.1.1 e 8.8.8.8. A Cloudflare confirmou a zona ativa.

O certificado Universal SSL para `*.hotdoogy.com` e `hotdoogy.com` está **Ativo**, com expiração exibida em 17/01/2027. Durante a emissão, `management` ficou temporariamente em Somente DNS; depois do certificado ativo, foi devolvido a **Com proxy**. O estado final é proxy somente em `management`. O teste direto no endereço da Cloudflare confirmou HTTPS válido, HTTP 200, `server: cloudflare` e `cf-cache-status: DYNAMIC`, com `Cache-Control: no-store`. O log do Nginx confirmou o IP real da requisição, correspondente ao IP informado pela Cloudflare, e não o IP do proxy. Uma nova aba do Safari carregou o Overview autenticado, com dados e sessão preservados; não foi executado um novo login/MFA. A migração de DNS/proxy foi concluída em 19/10/2026, aproximadamente às 18:21 (Nova York).

O modo SSL/TLS foi salvo como **Completo (estrito)**, preservando o certificado Let's Encrypt da VPS. A regra `Management - bypass cache`, com expressão `(http.host eq "management.hotdoogy.com")` e ação Ignorar cache, foi implantada e aparece Ativa. A versão TLS mínima da borda foi configurada como TLS 1.2, preservando o mínimo exigido pela origem.

O Nginx instalado foi ajustado nos dois blocos do hostname management para restaurar o visitante por `CF-Connecting-IP`, confiando exclusivamente nas faixas oficiais IPv4/IPv6 obtidas de `https://www.cloudflare.com/ips-v4` e `https://www.cloudflare.com/ips-v6` em 19/10/2026. A configuração versionada contém as mesmas diretivas. Atualizar as faixas com base nessas fontes quando necessário; nunca confiar nesse cabeçalho de qualquer origem. Assim, `$remote_addr`, os limites por IP e `X-Real-IP` continuam representando o visitante. O acesso direto à VPS ignora cabeçalhos de IP forjados.

Aplicado com backup `/root/hot-doogy-management-before-cloudflare-20261019T221106Z`, `nginx -t` e recarga do Nginx. Preservado o timeout de leitura de 150s existente na VPS (o modelo versionado tem 90s); nenhuma configuração de firewall ou de outros hosts foi alterada. HTTP público 200 e rejeição de IP forjado em conexão local foram conferidos antes da troca de DNS. O teste `certbot renew --cert-name management.hotdoogy.com --dry-run --non-interactive --no-random-sleep-on-renew` concluiu com sucesso após a troca dos nameservers, e foi repetido com sucesso após a ativação final do proxy.

Para manutenção: conferir o certificado de borda, HTTPS público e login/MFA, restauração do IP real no log, cache não servido como HIT e `certbot renew --cert-name management.hotdoogy.com --dry-run`. Manter `/.well-known/acme-challenge/` acessível para renovação. O IP da VPS continua público por `careers`; o proxy do management não significa isolamento completo da origem. Para reverter a preparação do Nginx, restaurar o backup, validar com `nginx -t` e recarregar. Para desativar apenas o proxy, alterar `management` para Somente DNS na Cloudflare, preservando DNS e HTTPS de origem.

## Atualizações

A cada aproximadamente dois minutos, `hot-doogy-update.timer` busca tags `v0.1.N` do repositório privado. Essas tags são criadas pelo GitHub após os testes de `main`. A VPS usa uma chave de implantação com leitura apenas deste repositório; não pode enviar alterações ao GitHub.

O atualizador versionado escolhe a versão numericamente mais recente que pertença ao histórico de `main` e executa novamente a verificação de sintaxe e os testes sem privilégios de root. Com a integração de banco instalada e configurada conforme a seção abaixo, confere o histórico remoto e aplica somente migrações posteriores à referência inicial, em transação única, antes de trocar o diretório ativo. Depois reinicia o serviço, verifica a disponibilidade e registra a versão ativa no Supabase. Se falhar, restaura o aplicativo anterior e registra o resultado; não desfaz o esquema do banco. As versões anteriores ficam em `/opt/hot-doogy/releases`.

Alterações locais continuam exigindo autorização antes do envio ao GitHub. Uma vez enviada e aprovada nos testes, a versão é instalada automaticamente na VPS. Com `HOT_DOOGY_SESSION_DIR` configurado, sessões verificadas por MFA são preservadas de forma criptografada fora das releases e duram 30 dias desde a verificação, sem renovação desse prazo por uso. O banco permanece no Supabase.

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
- Nginx limita requisições por IP e impõe orçamento adicional ao endpoint de login, independentemente da autenticação da aplicação.
- A correção de limite da aplicação depende de `HOT_DOOGY_TRUST_PROXY=loopback` no serviço. O Nginx sobrescreve `X-Real-IP`; a aplicação só confia nele quando o peer é loopback e a opção está habilitada. Nunca exponha a porta Node diretamente.
- Para instalar esta configuração de serviço após publicar a correção do login, instale `hot-doogy.service` em `/etc/systemd/system/`, execute `systemctl daemon-reload` e reinicie `hot-doogy`. A simples atualização do código não reinstala arquivos de systemd.
- `database/security-anonymous-access.sql` registra a migração já aplicada `security_revoke_unnecessary_anonymous_access`; não é necessário reaplicá-la para publicar a correção do login.

A senha adicional do subdomínio foi removida em 5 de outubro de 2026 a pedido do responsável, preservando o login individual e o MFA. Essas correções não significam aprovação integral do checklist: proteção da branch, scanners de segurança, validação completa de uploads e restauração de backup ainda precisam de conclusão.

## Sessões MFA por 30 dias

O serviço usa `StateDirectory=hot-doogy-auth` (modo 0700) e `HOT_DOOGY_SESSION_DIR=/var/lib/hot-doogy-auth`. A chave e o arquivo criptografado de sessões têm modo 0600. Não incluir esses arquivos em Git, artefatos ou backups comuns. Uma única instância do aplicativo deve usar esse diretório. O cookie HttpOnly contém somente um identificador aleatório; tokens do Supabase permanecem no servidor. Atualizações preservam o diretório. Sem a variável, a prévia local mantém sessões em memória.

É necessário reinstalar `hot-doogy.service` e executar `systemctl daemon-reload` antes de reiniciar a nova versão na VPS. A primeira implantação ainda exigirá novo login/MFA porque as sessões antigas só existem em memória. Depois, o prazo absoluto de 30 dias começa na verificação MFA. Logout, remoção de acesso, revogação/expiração pelo provedor ou limpeza do cookie podem exigir login antes desse prazo. MFA pendente continua limitado a dez minutos; usuários sem MFA continuam com sessões de oito horas. As políticas AAL2 do banco não são alteradas.

Para reverter, restaure a versão anterior e o serviço anterior; as sessões serão encerradas. Não reutilize uma cópia antiga dos tokens de sessão. Em caso de arquivo corrompido, o aplicativo não inicia: pare o serviço, remova apenas `sessions.enc` e reinicie para exigir novos logins (preserve a chave). A perda da chave invalida as sessões persistidas.

## Doogy AI / OpenClaw

Install `deploy/hot-doogy-openclaw.service` as `/etc/systemd/system/hot-doogy-openclaw.service` and `deploy/openclaw-bridge.conf` as `/etc/systemd/system/hot-doogy.service.d/openclaw-bridge.conf`, then reload systemd and restart `hot-doogy` after activating a release containing `server/doogy-bridge.mjs`. This uses the existing OpenClaw installation at `/usr/bin/openclaw` and its root-owned state in `/root/.openclaw`. It does not create a public listener or copy gateway/SSH credentials into the application. The Unix socket is restricted to root and the application group. See [integration details](../docs/integrations/doogy-ai.md).


## Versionamento conjunto do aplicativo e Supabase

Implementação preparada em 16 de outubro de 2026 (horário de Nova York). A migração `20261017030012_application_release_versioning` foi aplicada e verificada no Supabase. Ativado na VPS em 16 de outubro de 2026, às 23:12 (Nova York), pela release `v0.1.83`, commit `14a94e1bf34987c462ad55b9c40e8351dcd0bfdd`. O publicador terminou com sucesso, o site respondeu HTTP 200 e `deployment.current_release` confirmou a mesma versão/commit. O timer voltou a ficar ativo. A conexão de manutenção funcionou com a chave existente usando `UseKeychain=yes`; nenhum acesso novo foi criado. A configuração administrativa foi validada com TLS verify-full e está em arquivos root/0600 separados do serviço web.

O esquema administrativo `deployment`, fora da Data API, contém `current_release`, `release_events` e `migration_checksums`. Registra versão, commit exato, versão do esquema e horários. As tabelas têm RLS sem políticas e sem privilégios para anon, authenticated e service_role: o acesso é exclusivamente administrativo. O aviso informativo do Advisor sobre ausência de políticas é intencional ([explicação](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

`supabase/deployment-baseline.json` congela separadamente os arquivos locais históricos por SHA-256 e os registros remotos por versão, nome e fingerprint dos comandos. Há divergências históricas de identificação; a referência preserva o estado observado, não afirma equivalência entre SQL local e remoto. Arquivos históricos não são reaplicados nem renomeados. Histórico desconhecido, alterado, ausente ou migração nova com data anterior à referência bloqueia a publicação. Qualquer reconciliação futura precisa de revisão explícita; não executar repair/reset/replay automático. Migrações posteriores têm comparação exata do SQL registrado e checksum.

### Instalação administrativa, após publicação autorizada

1. Instalar o cliente PostgreSQL (`/usr/bin/psql`) na VPS. Confirmar o host real do pooler em modo de sessão (porta 5432) no painel Supabase; não presumir que o exemplo corresponde ao projeto.
2. Preparar `/etc/hot-doogy/database-deploy.json` a partir de `database-deploy.example.json`, com proprietário root e modo 0600. Preparar `/etc/hot-doogy/database-deploy.pgpass`, também root/0600, com credencial administrativa autorizada para migrações. Não reutilizar a credencial de backup se ela for somente leitura. O certificado CA deve existir no caminho configurado; a conexão exige TLS verify-full. Esses arquivos nunca entram no Git ou no ambiente do serviço web.
3. Após autorizar o envio e passar o CI, usar o checkout da nova versão aprovada para instalar `deploy/update.sh` em `/usr/local/sbin/hot-doogy-update`. O `deploy/install.sh` também instala os serviços e exige os arquivos de conexão. Não instalar o atualizador antes de a nova release estar disponível: versões anteriores não contêm `scripts/deploy-database.mjs`.
4. Executar `systemctl start hot-doogy-update` e verificar o journal, `/opt/hot-doogy/deployed-version`, `deployment.current_release` e a disponibilidade pública. Não marcar uma versão como ativa manualmente.

A migração e o registro de histórico são confirmados na mesma transação, protegida por lock administrativo. Falha de migração mantém o aplicativo anterior. A marcação ativa só ocorre após o teste de disponibilidade. Se o registro de ativação falhar, o aplicativo também volta à versão anterior. Se a recuperação falhar, o registro ativo é removido; uma falha de conexão durante a recuperação exige conferir banco e VPS antes de confiar no registro. `prepared` indica preparação, não instalação concluída. Falhas anteriores ao commit da preparação aparecem apenas no journal, pois a transação inteira é desfeita.

Novas migrações precisam ser compatíveis com o aplicativo anterior: alterações destrutivas ou remoção de colunas exigem rollout separado e revisão. A reversão do código preserva o esquema expandido e os dados. Esse controle de versão não é backup nem restauração de dados e não versiona automaticamente arquivos do Storage, credenciais, Auth ou Edge Functions.

Consulta administrativa:

```sql
select * from deployment.current_release;
select * from deployment.release_events order by id desc limit 20;
select * from deployment.migration_checksums order by version desc;
```
