# Histórico de mudanças do banco

Em 7 de outubro de 2026, foram recuperadas 74 migrações do projeto `kfnsfnytnnpwptklmbip`, consultando apenas `supabase_migrations.schema_migrations`. Os arquivos de `migrations/` preservam as versões, os nomes e o conteúdo de cada comando registrado, com separadores SQL entre os comandos. `migration-history.json` registra a origem, quantidade de comandos e SHA-256 dos arquivos importados.

## Limites deste histórico

Estas migrações já foram aplicadas no Supabase. Importá-las para o Git não as aplica novamente. Não executar reset, push, reparo de histórico ou replay automático no banco publicado.

O histórico não inclui necessariamente o esquema inicial ou alterações feitas fora de migrações. A reconstrução das 74 migrações foi validada em Supabase local isolado, usando a base recuperada de `bootstrap/` e dois registros sintéticos. Consulte `tests/README.md` para o alcance e as limitações. Os scripts de `../database/` são referências anteriores; não constituem uma segunda sequência para executar sobre estas migrações.

Este diretório não é backup dos dados, das credenciais ou dos arquivos do Storage. Não foi configurada publicação automática do banco. A instância local temporária usada na validação não foi vinculada à produção.

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
