# HOT DOOGY Operations

Aplicativo de gestão da HOT DOOGY para Sherwood Plaza e Natick Mall. Interface e servidor Node.js, com autenticação, banco e arquivos privados no Supabase.

## Executar

Requer Node.js 24. Não há dependências de instalação nem etapa de build.

```sh
npm start
```

O endereço local é http://127.0.0.1:4173. O acesso requer uma conta ativa vinculada à organização no banco. O sistema também está hospedado na VPS; nesta etapa, o acesso à VPS é por túnel SSH. Subdomínio e HTTPS ficam para a próxima etapa. Consulte [a documentação da hospedagem](deploy/README.md).

## Configuração

O servidor aceita `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. Para o armazenamento, configure as variáveis `SUPABASE_S3_*` no servidor ou indique o arquivo privado em `HOT_DOOGY_S3_CONFIG`. O [modelo de configuração](deploy/supabase-s3.env.example) contém apenas os nomes e valores públicos. Não há caminhos para pastas de um computador específico. Nunca coloque credenciais no código, em commits ou nos arquivos públicos.

O GitHub contém o código, as imagens da marca, as bibliotecas da interface, os testes independentes e os arquivos de instalação. Dados do negócio, usuários, fotos dos produtos e documentos permanecem no Supabase; a VPS possui sua própria configuração privada. Exportações, auditorias, capturas de tela e os scripts históricos de importação em `scripts/` não são necessários para executar o aplicativo. Os scripts de importação e os testes históricos podem exigir esses arquivos de referência, mas não são usados pelo serviço nem pela publicação automática.

## Verificação

```sh
npm run check
npm run test:ci
```

A suíte `test:ci` usa somente dados sintéticos e funciona em um clone limpo. `npm test` também executa verificações locais contra extratos privados, que não são enviados ao GitHub. Essa suíte completa exige os arquivos locais de referência.

## Histórico e versões

Cada conjunto de alterações concluído deve ser registrado em um commit e enviado ao GitHub. Salvar um arquivo no editor, sozinho, não cria um commit nem publica uma versão.

A automação valida cada atualização de `main`. Quando as verificações passam, cria uma tag e uma GitHub Release com o formato `v0.1.N`, onde N é o número da execução. Cada versão aponta para o commit exato; números podem ter intervalos quando uma execução falha ou valida uma pull request. Reexecutar a mesma execução não cria uma segunda versão.

Pull requests recebem verificações, mas não criam versões. A VPS verifica novas versões a cada aproximadamente dois minutos, executa os testes e instala a versão aprovada. A troca reinicia o sistema e exige novo login. Alterações locais só são enviadas ao GitHub com autorização do usuário, conforme `AGENTS.md`.

O repositório deve ser privado. Exportações do banco, auditorias, capturas de tela, documentos de operações e segredos locais estão excluídos do controle de versão.

## Idioma e unidades

A interface, mensagens da API, relatórios e PDFs usam inglês americano. Números usam ponto decimal e vírgula de milhar; datas seguem o padrão dos EUA e horários operacionais continuam em `America/New_York`. CSVs usam vírgulas e PDFs de transferência usam papel US Letter.

Unidades americanas aparecem primeiro nos seletores; as métricas permanecem disponíveis no catálogo. Cada item precisa ter a conversão cadastrada para utilizar uma unidade. As quantidades de receitas e contagens são convertidas ao trocar a unidade. Contagens são enviadas na unidade de contagem já autorizada pelo banco. Nenhuma conversão, unidade-base ou registro existente é reescrito pela preferência de exibição.

Os rótulos de momento de contagem estão em inglês, mantendo os valores legados aceitos pelo banco. Validações do banco são traduzidas na API, sem migração de dados. `tests/localization.test.mjs` verifica essas regras e participa de `npm run test:ci`.
