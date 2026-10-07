# Preferências de trabalho

## Commits locais

- Ao concluir cada alteração solicitada, verifique o resultado e crie um commit local com uma descrição clara, sem exigir nova confirmação para o commit.
- Inclua somente os arquivos relativos à alteração concluída. Preserve mudanças anteriores não relacionadas e nunca inclua credenciais.
- Não crie commits de alterações incompletas ou com verificações necessárias pendentes; informe o impedimento.
- Criar um commit local não autoriza envio ao GitHub. Não execute push nem publique imediatamente; siga a autorização descrita abaixo.

## Mudanças no banco Supabase

- Registrar cada nova mudança de estrutura, função ou permissão em uma migração SQL em `supabase/migrations/`, criada pela CLI Supabase e validada em ambiente isolado.
- Incluir a migração no mesmo commit local da alteração correspondente do aplicativo, após as verificações necessárias.
- Preservar migrações já aplicadas. Scripts históricos em `database/` não substituem uma nova migração.
- Não aplicar SQL no banco remoto apenas por criar um commit ou publicar o front end. A aplicação exige escopo autorizado e verificação do histórico e do resultado.
- Consultar `supabase/README.md` para os limites do histórico importado. Não executar replay, reset ou reparo automático na produção.

## Envio de alterações ao GitHub

- Ao concluir as alterações solicitadas, prepare e verifique o resultado localmente.
- Antes de enviar alterações ao GitHub, apresente um resumo breve do que será enviado e pergunte se o usuário autoriza o envio.
- Aguarde autorização explícita antes de executar `git push` ou publicar alterações por API, MCP ou interface do GitHub.
- Uma autorização vale para o conjunto de alterações apresentado; não autoriza envios futuros automaticamente.
- Se o usuário já pediu explicitamente o envio daquele conjunto de alterações, essa solicitação conta como autorização, sem necessidade de perguntar novamente.
- Não configure envio automático de alterações locais sem uma nova solicitação explícita do usuário.
