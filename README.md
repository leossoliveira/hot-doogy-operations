# HOT DOOGY Operations

Aplicativo de gestão da HOT DOOGY para Sherwood Plaza e Natick Mall. Interface e servidor Node.js, com autenticação, banco e arquivos privados no Supabase.

## Executar

Requer Node.js 24. Não há dependências de instalação nem etapa de build.

```sh
npm start
```

O endereço local é http://127.0.0.1:4173. O acesso requer uma conta ativa vinculada à organização no banco. O sistema também está hospedado na VPS; nesta etapa, o acesso à VPS é por túnel SSH. Subdomínio e HTTPS ficam para a próxima etapa. Consulte [a documentação da hospedagem](deploy/README.md).

## Configuração

O servidor aceita `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. As credenciais privadas de armazenamento devem ficar fora do repositório. Na configuração local atual, `HOT_DOOGY_S3_CONFIG` indica o arquivo privado com as variáveis S3. Nunca coloque credenciais no código, em commits ou nos arquivos públicos.

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
