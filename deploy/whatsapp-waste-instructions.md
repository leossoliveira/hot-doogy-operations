## Acesso operacional ao desperdício pelo WhatsApp — 21/10/2026

Para registrar desperdício e baixar estoque, use exclusivamente o adaptador:
`/usr/bin/python3 /usr/local/lib/hot-doogy/whatsapp-waste.py --input /caminho/privado/relato.json`

Não usar `public.record_waste` via MCP SQL, não pedir login/MFA ao remetente, não fabricar `auth.uid()`, claims ou sessão de usuário. O aplicativo humano mantém suas proteções de MFA. A credencial de máquina já está configurada no servidor; não ler, imprimir ou copiar seu arquivo.

O JSON aceita somente `groupId` (JID completo), `messageId` (ID nativo da mensagem original, preservado em correções), `teamMemberId` (responsável cadastrado real), `reason`, `notes` e `lines`. Cada linha contém `itemId`, `areaId`, `unitId` (ID de inventory_item_units) e `quantity` positiva na unidade escolhida. Não fornecer localização, data, identidade do agente, hash ou credenciais: o adaptador deriva esses dados da mensagem e do grupo. Evidência deve existir no histórico nativo deste agente. A responsabilidade informada deve ser confirmada; o remetente não substitui automaticamente Reported by.

Conferir previamente se o relato já foi lançado pelo fluxo antigo, além da deduplicação automática da mensagem. Para produto composto, consultar receita ativa, rendimento, conversões e loja; decompor somente os componentes realmente descartados. Subpreparações são saídas do estoque da preparação cadastrada, sem baixar ingredientes crus novamente. Não inventar conversão, storage area ou quantidade. Na perda parcial confirmada do Doogy Deluxe, a salsicha reaproveitada fica excluída de todas as linhas. Notas contêm somente o relato humano; origem e identidade técnica ficam na auditoria.

`--check` executa a mesma rotina e encerra com ROLLBACK; nunca confirma um lançamento. Sem esse parâmetro, o sucesso precisa conter `committed:true`, ID do waste, loja e IDs/quantidades dos movimentos. As linhas e os movimentos são gravados atomicamente. Repetir mensagem e conteúdo idênticos retorna os mesmos IDs; mudança posterior é recusada e exige reconciliação com Leonardo, sem nova chave artificial ou baixa duplicada.

Os gatilhos, autorizações e regras de comunicação do documento de cada grupo continuam obrigatórios. Não reprocessar histórico, iniciar outras pendências nem enviar mensagem por causa da instalação. Diagnósticos somente no privado de Leonardo.
