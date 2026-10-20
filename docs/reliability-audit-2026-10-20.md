# Revisão de confiabilidade — 20/10/2026

## Situação e evidência

A revisão partiu das falhas reais ao aprovar invoice e editar um item de fornecedor. A correção anterior da classificação humana de documentos já está na versão v0.1.99, com a migração 20261020215843 aplicada. Esta revisão constitui outro conjunto de alterações, ainda local.

Inspeção de produção somente para leitura:

- Logs do banco entre 22:09 e 22:28 UTC registraram 95 cancelamentos por limite de tempo. Um deles ocorreu no UPDATE de inventory_items dentro de operations_command/private.web_operation, correspondente ao fluxo de edição de catálogo.
- Logs do proxy registraram respostas 502 e requisições canceladas 499 em /api/data; /api/command também apresentou 502. Houve conexões encerradas durante reinícios de publicação às 17:49:28 e 18:07:57 de Nova York.
- Estatísticas acumuladas, não limitadas à janela acima: operations_preparation_sales tinha 30.807 chamadas e média de 3.626,5 ms; leituras de inventory_transactions, 28.663 chamadas e média de 1.799,2 ms. Esses números identificam concentração de trabalho, não medem desempenho depois da correção.
- Aproximadamente 16.050 fatos de venda e 2.414 movimentações de estoque eram lidos no conjunto completo. Cada sessão podia iniciar seu próprio cálculo de receitas e multiplicar consultas concorrentes.
- Uma amostra posterior de conexões mostrou 25 conexões, 10 ativas e nenhuma aguardando lock. Isso não exclui bloqueios transitórios na hora da falha.
- A tela de item afirmava que as alterações estavam salvas antes de receber confirmação. Erros de validação e timeout podiam virar erro de gateway e perder a explicação original.

A combinação de consultas caras, concorrência multiplicada e requisições interrompidas é compatível com os incidentes observados. Não há evidência suficiente para atribuir todo incidente histórico a uma única causa.

## Correções deste conjunto

1. Leituras do conjunto operacional têm limite compartilhado de oito consultas por processo, quatro por carregamento. A falha de uma tabela cancela o restante daquele carregamento. Paginação por chave evita reler todos os registros anteriores; não elimina nem trunca o histórico.
2. Carregamentos simultâneos da mesma sessão compartilham apenas a solicitação em andamento. Escritas bem-sucedidas invalidam essa geração; dados não são compartilhados entre usuários. O navegador também reúne atualizações simultâneas e passa a atualizar a cada 60 segundos quando a tela está livre.
3. Cálculos de consumo são solicitados nas telas que os usam: estoque, compras e vendas. Abrir fornecedor, invoice ou visão geral não inicia esse cálculo. Os cálculos compartilham um limite de uma consulta por processo, com lotes de 50 vendas e intervalo de cinco minutos após falha. A apuração de preparação usa o mesmo limite.
4. Validação, conflito e timeout do banco têm respostas distintas de falhas de gateway. Cancelamentos confirmados permitem corrigir ou repetir o formulário; resposta perdida permanece resultado desconhecido.
5. Edição de fornecedor conserva o comando e seus valores quando o resultado é desconhecido. Repetir usa o mesmo identificador e conteúdo; os campos ficam bloqueados até resolver essa tentativa. A proteção existente avisa ao tentar sair com alterações. Isso não constitui recuperação persistente da edição após fechar o navegador.
6. A criação de fornecedor conserva seu diário de recuperação existente. Recusas confirmadas desbloqueiam a correção. Uma falha ao atualizar a lista depois de salvar não transforma uma escrita confirmada em falha de salvamento.
7. O rodapé do editor só orienta a salvar; não afirma sucesso antecipadamente.
8. O servidor passa a aguardar solicitações aceitas durante encerramento, por até 17 segundos, compatível com o prazo atual do serviço. Isso reduz interrupções, mas não é implantação sem indisponibilidade: novas conexões e operações além do prazo ainda podem falhar.
9. Logs registram código de erro do banco e duração/status/identificador das requisições lentas ou malsucedidas, sem incluir corpos, tokens ou parâmetros de consulta.
10. A verificação automática de publicação passa a executar cenários de falha e recuperação de fornecedor, além da contagem já existente.

Nenhuma alteração nova de estrutura do banco ou migração faz parte deste conjunto. Nenhuma escrita de teste foi feita nos registros de usuários reais.

## Verificação

- 429 testes JavaScript aprovados; verificações de sintaxe, histórico de migrações e baseline aprovadas.
- 13 testes de backup aprovados.
- Navegador com API simulada: timeout confirmado ao editar fornecedor, preservação dos campos, perda de resposta, repetição idêntica, falha de atualização após sucesso, criação com repetição idempotente, navegação de 12 módulos sem exceções não tratadas e acionamento dos cálculos nas rotas consumidoras.
- Navegador: contagem vazia, correção após recusa, preservação após falha/cancelamento, fechar/retomar e recuperação de versão antiga.
- Banco PostgreSQL isolado: invoices e classificação humana, permissões/MFA/escopo, duplicidade, conflitos; recebimento parcial e rollback; rascunhos de contagem, versão, permissões, conclusão atômica e repetição idempotente.
- Novos testes de concorrência: três usuários conservam todos os registros com teto global de oito leituras; cálculos respeitam teto de uma consulta; sessões não compartilham dados; escrita invalida leitura em andamento; encerramento aguarda resposta de escrita HTTP aceita.

A navegação de módulos não equivale a testar toda combinação de cadastro, perfil e operação no navegador. A suíte automatizada amplia a cobertura de regras, mas não garante ausência de defeitos.

## Verificação necessária depois da publicação

Confirmar a versão em execução e comparar janelas equivalentes de tráfego: cancelamentos 57014, erros 5xx por rota, latência de /api/data e /api/command, memória e tempo de cálculo nas telas consumidoras. Fazer uma edição real autorizada e conferir a persistência ao reabrir. Verificar a próxima publicação com solicitação em andamento.

A redução de concorrência protege as escritas, mas pode aumentar o tempo até concluir cálculos grandes. Se os cancelamentos persistirem, a próxima investigação deve medir planos/RLS e cache das funções de cálculo com o perfil real, antes de propor migração ou aumento de capacidade. A aplicação ainda carrega um conjunto amplo de dados; este trabalho não transforma a arquitetura em carregamento totalmente por módulo nem fornece failover de infraestrutura.

Publicação depende de autorização para este conjunto conforme AGENTS.md. Antes dela, a melhora em produção continua não comprovada. Nenhum sistema pode garantir que falhas de rede, infraestrutura ou software nunca mais ocorram.
