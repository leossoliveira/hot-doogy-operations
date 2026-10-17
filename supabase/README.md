# Histórico de mudanças do banco

Em 7 de outubro de 2026, foram recuperadas 74 migrações do projeto `kfnsfnytnnpwptklmbip`, consultando apenas `supabase_migrations.schema_migrations`. Os arquivos de `migrations/` preservam as versões, os nomes e o conteúdo de cada comando registrado, com separadores SQL entre os comandos. `migration-history.json` registra a origem, quantidade de comandos e SHA-256 dos arquivos importados.

## Limites deste histórico

Estas migrações já foram aplicadas no Supabase. Importá-las para o Git não as aplica novamente. Não executar reset, push, reparo de histórico ou replay automático no banco publicado.

O histórico não inclui necessariamente o esquema inicial ou alterações feitas fora de migrações. A reconstrução das 74 migrações foi validada em Supabase local isolado, usando a base recuperada de `bootstrap/` e dois registros sintéticos. Consulte `tests/README.md` para o alcance e as limitações. Os scripts de `../database/` são referências anteriores; não constituem uma segunda sequência para executar sobre estas migrações.

Este diretório não é backup dos dados, das credenciais ou dos arquivos do Storage. A integração posterior está descrita na seção Versionamento conjunto abaixo. A instância local temporária usada na validação não foi vinculada à produção.

## Novas alterações

1. Inspecionar a mudança necessária e o estado do banco. Trabalhar em ambiente de desenvolvimento ou teste isolado.
2. Usar a CLI Supabase (`supabase migration new nome_da_alteracao`) para criar uma nova migração. Consultar a ajuda da versão instalada; não editar arquivos históricos já aplicados.
3. Escrever e validar o SQL e os efeitos sobre permissões, dados e compatibilidade do aplicativo. Mudanças dependentes do banco devem incluir sua migração no mesmo commit do código.
4. Concluir as verificações e criar o commit local, conforme `../AGENTS.md`. Não incluir segredos nem exportações de dados operacionais.
5. Aplicar no banco remoto somente dentro do escopo autorizado, após conferir o histórico e validar a migração. Um commit local ou envio do front end não aplica SQL no Supabase.
6. Confirmar o resultado e o registro da migração remota. Registrar o procedimento de reversão quando aplicável; migrações não desfazem mudanças automaticamente.

A CLI não estava instalada no computador durante a importação histórica. Os nomes importados vieram diretamente do Supabase, sem criação de novas versões. O manifesto descreve esse lote inicial; novas migrações terão seu histórico no Git e no Supabase quando aplicadas.

## Validation status — October 7, 2026

The isolated replay passed: recovered initial schema plus all 74 immutable migrations. Catalog comparison matched 85 tables, 816 columns, 210 public policies and 113 function identities. Synthetic tests passed for application table reads, manager store/tenant isolation, admin MFA enforcement and anonymous denial.

See [the reproducible procedure and scope](tests/README.md) and [the report](tests/replay-report-2026-10-07.json). `bootstrap/` is a recovered test prerequisite, not an additional production migration. No business data was exported; no production write occurred. `npm run check` continues to verify the original migration checksums.


## Versionamento conjunto — 16 de outubro de 2026

A migração `20261017030012_application_release_versioning` foi criada pela CLI e aplicada no Supabase, com o histórico e o SQL exato registrados na mesma transação. Cria apenas metadados administrativos no esquema `deployment`; não altera dados operacionais. RLS e privilégios foram verificados. Nenhum aplicativo foi marcado como ativo sem conferir sua instalação.

O publicador preparado aplica novas migrações antes de ativar o código e registra a versão após a checagem de disponibilidade. A ativação na VPS está pendente de acesso SSH e publicação autorizada do código. Consulte [instalação, credenciais e limites](../deploy/README.md#versionamento-conjunto-do-aplicativo-e-supabase). A publicação futura de uma release com migrações autoriza a execução das migrações revisadas daquela release; enviar uma mudança que dependa de banco deve deixar esse efeito claro no resumo para autorização. Não executar `supabase db push` sobre o histórico legado divergente.

`deployment-baseline.json` preserva separadamente o estado histórico local e remoto, sem reparar ou repetir migrações antigas. O publicador recusa alterações desse estado e migrações desconhecidas. A nova migração foi validada em PGlite isolado com usuários sintéticos, sem credenciais de produção. O teste cobre bloqueio de histórico divergente, rollback transacional do lote, repetição segura, alteração de conteúdo, identidade da versão, ativação após preparo e retorno ao aplicativo anterior preservando o esquema.

Para reproduzir, instalar `@electric-sql/pglite@0.3.14` em uma pasta temporária e executar `supabase/tests/release-versioning.mjs` com `PGLITE_MODULE_PATH` apontando para `dist/index.js`. O CI executa esse teste antes de criar a release.

Reversão administrativa: restaurar o atualizador anterior e o aplicativo anterior; preservar as tabelas administrativas e o histórico para auditoria. Não remover a migração aplicada nem desfazer dados do negócio. A ausência de políticas RLS neste esquema é intencional: nenhum usuário da aplicação pode ler ou gravar os registros.

Verificação remota adicional: o preparo gerado pelo publicador passou contra o histórico real em transação encerrada com ROLLBACK. Nenhuma release fictícia, checksum de teste ou versão ativa ficou gravada.
