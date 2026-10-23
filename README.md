# HOT DOOGY Operations

Aplicativo de gestão da HOT DOOGY para Sherwood Plaza e Natick Mall. Interface e servidor Node.js, com autenticação, banco e arquivos privados no Supabase.

## Project structure

See [the documentation index](docs/README.md) and [the workspace map](docs/workspace-structure.md) for the current layout. Application code, technical documentation and migrations are versioned here. Private operational context and historical ZIP backups live outside this repository.

## Executar

Requer Node.js 24 (versão definida em `.nvmrc` e `package.json`). Não há dependências de instalação nem etapa de build.

```sh
npm start
```

O endereço local é http://127.0.0.1:4173. Em produção, acesse https://management.hotdoogy.com sem túnel SSH. O acesso usa o login individual de uma conta ativa vinculada à organização, com MFA administrativo. Não há senha compartilhada adicional do navegador. Consulte [a documentação da hospedagem](deploy/README.md).

## Configuração

O servidor aceita `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. Para o armazenamento, configure as variáveis `SUPABASE_S3_*` no servidor ou indique o arquivo privado em `HOT_DOOGY_S3_CONFIG`. O [modelo de configuração](deploy/supabase-s3.env.example) contém apenas os nomes e valores públicos. Não há caminhos para pastas de um computador específico. Nunca coloque credenciais no código, em commits ou nos arquivos públicos.

O GitHub contém o código, as imagens da marca, as bibliotecas da interface, os testes independentes e os arquivos de instalação. Dados do negócio, usuários, fotos dos produtos e documentos permanecem no Supabase; a VPS possui sua própria configuração privada. Exportações, auditorias, capturas de tela e os scripts históricos de importação em `scripts/` não são necessários para executar o aplicativo. Os scripts de importação e os testes históricos podem exigir esses arquivos de referência, mas não são usados pelo serviço nem pela publicação automática.

## Verificação

```sh
npm run check
npm run test:ci
```

`npm test` e `npm run test:ci` executam a mesma suíte independente de extratos privados, com descoberta automática. Os testes antigos dependentes de exportações ficam em `tests/historical/` e exigem `npm run test:historical`. Consulte [o guia de testes](tests/README.md).

## Histórico e versões

Cada conjunto de alterações concluído e verificado deve ser registrado em um commit local. O envio ao GitHub exige autorização explícita. Salvar um arquivo no editor, sozinho, não cria um commit nem publica uma versão.

A automação valida cada atualização de `main`. Quando as verificações passam, cria uma tag e uma GitHub Release com o formato `v0.1.N`, onde N é o número da execução. Cada versão aponta para o commit exato; números podem ter intervalos quando uma execução falha ou valida uma pull request. Reexecutar a mesma execução não cria uma segunda versão.

Pull requests recebem verificações, mas não criam versões. A VPS verifica novas versões a cada aproximadamente dois minutos, executa os testes e instala a versão aprovada. A troca reinicia o sistema; sessões persistidas por MFA são preservadas conforme a configuração da VPS. Alterações locais só são enviadas ao GitHub com autorização do usuário, conforme `AGENTS.md`.

O repositório deve ser privado. Exportações do banco, auditorias, capturas de tela, documentos de operações e segredos locais estão excluídos do controle de versão.

## Idioma e unidades

A interface, mensagens da API, relatórios e PDFs usam inglês americano. Números usam ponto decimal e vírgula de milhar; datas seguem o padrão dos EUA e horários operacionais continuam em `America/New_York`. CSVs usam vírgulas e PDFs de transferência usam papel US Letter.

Unidades americanas aparecem primeiro nos seletores; as métricas permanecem disponíveis no catálogo. Cada item precisa ter a conversão cadastrada para utilizar uma unidade. As quantidades de receitas e contagens são convertidas ao trocar a unidade. Contagens são enviadas na unidade de contagem já autorizada pelo banco. Nenhuma conversão, unidade-base ou registro existente é reescrito pela preferência de exibição.

Os rótulos de momento de contagem estão em inglês, mantendo os valores legados aceitos pelo banco. Validações do banco são traduzidas na API, sem migração de dados. `tests/localization.test.mjs` verifica essas regras e participa de `npm run test:ci`.

## Purchasing: usage, planning, and order history

Purchasing opens the order history. Plan order opens a dedicated planning page, New immediate order opens the order form, and Usage by Supplier is available in Reports. Usage and Planning have independent dates, supplier filters, and searches. Planning calculates usage directly from the sales-derived summary without requiring a visit to Usage. Both start with blank date fields; usage and comparisons are calculated only after a date range is applied. Usage groups active supplier items by supplier and compares inclusive date ranges using the same weekday-aligned comparison as Prep. The estimates include direct purchased items and purchased ingredients in prepared items, using active recipe versions, production-location components, yields, and waste. Shared items show the same demand in each supplier catalog; this is not supplier-attributed consumption. Missing calculations or coverage remain unknown.

Planning uses count units for demand and last physical counts, then converts net requirements into each supplier’s ordering unit. Choose one location and supplier, enter final quantities, and select Review order to open the existing purchase-order draft form. Saving uses the existing authenticated order command; it does not send an order to a supplier. Quantities remain in the current browser session until saved or cleared.

History supports All, Awaiting receipt (ordered and partially received), Drafts, and Received, with All/25/50/100 items per page. Usage and Planning each have their own All/25/50/100 selector. Planning preserves quantities across pages and includes them all when reviewing an order. History also filters by supplier and inclusive order dates in New York time (creation date for drafts); either date can be left blank. All three views use the standard Previous/Next pagination controls. Suppliers are sorted A–Z.

Database prerequisite: the backward-compatible `itemRows` response in `private.web_preparation_sales` from `database/operations-command.sql`. It was applied as `purchasing_usage_extend_preparation_summary`. Existing Prep response rows and access controls are preserved. The server computes both summaries in the same background job, keeping the initial login request nonblocking.

O versionamento conjunto com o Supabase está ativo desde a release v0.1.83. O publicador aplica novas migrações antes de ativar o aplicativo e registra versão e commit após a verificação de disponibilidade. Consulte [o procedimento e o estado da instalação](deploy/README.md#versionamento-conjunto-do-aplicativo-e-supabase).
