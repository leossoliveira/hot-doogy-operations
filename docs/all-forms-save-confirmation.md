# Confirmação imediata nos formulários publicados

A confirmação depende da resposta da escrita, mas não da leitura posterior da lista. O formulário fecha ou libera seus controles assim que as escritas necessárias terminam. O recarregamento ocorre em segundo plano; uma falha de leitura não transforma a gravação confirmada em erro.

Cobertura: cadastro e exclusão de fornecedores/itens; fotos e receitas pelo commit compartilhado; criação e edição de pedidos; recebimentos e ocorrências; criação, edição, etapas e ocorrências de transferências; contagens completas, seções e correções de quantidade; produção e atribuição de preparador; desperdício; rascunhos, anexos, aprovação e pagamento de invoices; RH, perfis, importação de horas, candidaturas; tarefas, status e calendário. Autenticação e leituras necessárias antes de uma operação continuam aguardadas.

A aprovação de invoice usa o updatedAt retornado pelo RPC que acabou de salvar o rascunho. Não há leitura completa entre salvar e aprovar. O banco continua conferindo a versão, permissões, conferência humana e documento original. Nenhuma aprovação, pagamento ou movimentação é inferida pelo cliente.

Escritas invalidam leituras anteriores. Registros cuja nova versão ainda não chegou não reabrem com dados antigos. Outros registros continuam acessíveis. A atualização global não substitui dados durante outro formulário aberto. Caches de RH, candidaturas e tarefas usam gerações para rejeitar respostas antigas e respostas de sessões encerradas. Não houve alteração de esquema.

## Verificações

- Testes de navegador com resposta de lista bloqueada: edição e criação de pedido, pagamento e aprovação de invoice, conclusão de contagem, cadastro RH e tarefa. Exigem confirmação/fechamento em até 1,5 segundo após a resposta simulada da escrita. Aprovação verifica o uso da nova versão retornada pelo servidor.
- Testes de fornecedor: erro definitivo, resultado desconhecido, repetição exata do comando, leitura posterior com falha, preservação de outro formulário e proteção contra edição com versão antiga.
- Testes de contagem: validação, recuperação de rascunho, quantidades vazias, rejeição e recuperação de conclusão desconhecida.
- A validação automática de publicação executa a nova bateria de formulários.

Os testes usam dados sintéticos locais. A validação em produção deve preservar valores e evitar aprovações financeiras ou movimentações de estoque artificiais. Confirmar a versão publicada, medir a confirmação em um salvamento sem mudança de valores e conferir o registro no banco. Isso não representa garantia de latência da rede ou ausência de falhas futuras.
