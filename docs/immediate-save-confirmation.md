# Confirmação de salvamento do item de fornecedor

O editor confirma a gravação e fecha assim que terminam as escritas necessárias, incluindo a foto quando alterada. A leitura completa do catálogo ocorre em segundo plano. Uma falha dessa leitura é apresentada como atualização pendente, sem reclassificar a gravação confirmada como erro.

A atualização usa as proteções de sessão, geração e edição em andamento de refreshData(true). Ela não aplica nem renderiza uma resposta atrasada sobre outro formulário aberto. O item recém-salvo aguarda uma versão atualizada antes de ser editado de novo; isso também cobre outros fornecedores vinculados ao mesmo item compartilhado. O usuário pode continuar trabalhando em outros itens e telas.

Não há mudança no banco nem na confirmação de escritas com resultado desconhecido. Essas tentativas continuam conservando o mesmo comando para repetição segura. A confirmação continua dependendo da resposta real da escrita; não é sucesso otimista.

Verificação local: 430 testes JavaScript, verificações de sintaxe e histórico, além dos testes de navegador. O novo cenário mantém a resposta de atualização da lista indefinidamente pendente e exige o fechamento do editor em menos de 1,5 segundo após uma resposta simulada de escrita. Ele também verifica a proteção contra reedição com versão antiga, a preservação de outro formulário quando chega a resposta atrasada e a reabertura após atualização.

A validação em produção deve medir do clique até o fechamento/confirmacão e conferir a escrita no banco separadamente do tempo de recarga da lista. Não alterar valores reais de cadastro para gerar o teste.
