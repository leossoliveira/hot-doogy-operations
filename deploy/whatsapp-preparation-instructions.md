# Preparação: produção, ingredientes e transferências

Implementação local de 21/10/2026. A migração e o adaptador foram preparados para validação isolada; este documento não comprova instalação no servidor ou acesso pelo agente ativo.

## Caminho operacional

Usar exclusivamente `/usr/bin/python3 /usr/local/lib/hot-doogy/whatsapp-preparation.py --input /caminho/privado/registro.json` para gravar. `--catalog` consulta somente receitas de Batch Prep, itens usados, unidades, áreas e responsáveis. Nunca ler ou imprimir `/etc/hot-doogy/whatsapp-preparation.json`, que contém a conexão da identidade de máquina. Não usar credenciais de serviço geral, MCP SQL, claims fabricadas nem sessão humana para contornar permissões.

O grupo permitido é `120363380724268297@g.us`, agente `doogy-food-prep`. O adaptador verifica grupo, remetente e ID nativo no histórico SQLite deste agente. IDs e conteúdo de origem vêm dos metadados nativos, não do texto enviado. Data e SHA-256 da evidência são derivados pelo adaptador. Para produção, exige imagem estruturada da preparação no registro ou em mensagens referenciadas do mesmo grupo. A etiqueta continua opcional. Se o runtime não conservar a imagem nesse formato, a verificação falha com segurança; conferir essa compatibilidade antes de ativar.

Interpretar foto/texto conforme o procedimento aprovado. Resolver o nome e a UOM pelo catálogo; responsável é quem produziu, nunca automaticamente o remetente. Não estimar conversões, ingredientes ou áreas. Preservar a equivalência `each = unit` somente quando vinculada à mesma unidade cadastrada; o adaptador recebe o ID real de `inventory_item_units`.

### Produção

JSON de entrada (substituir os valores simbólicos por IDs reais do catálogo):

```json
{
  "groupId": "120363380724268297@g.us",
  "messageId": "ID_NATIVO_ORIGINAL",
  "kind": "production",
  "photoMessageIds": ["ID_NATIVO_DA_FOTO_SE_SEPARADA"],
  "data": {
    "itemId": "UUID_DO_PREPARO",
    "itemUnitId": "UUID_DA_UNIDADE_DO_ITEM",
    "recipeVersionId": "UUID_DA_VERSAO_ATIVA",
    "areaId": "UUID_DA_AREA_DO_PREPARO",
    "preparedTeamMemberId": "UUID_DE_QUEM_PRODUZIU",
    "qty": 3,
    "notes": "Observação operacional, se houver"
  }
}
```

Omitir `photoMessageIds` se a foto estiver na mensagem original. Não fornecer ID do lote, loja, data de conclusão ou status: o adaptador e o banco fixam esses dados. A produção ocorre sempre no Sherwood. Indicar destino Natick não cria transferência.

A rotina compartilhada `private.complete_preparation` grava lote, componentes, consumos, entrada, auditoria e evidência de deduplicação na mesma transação. A conclusão pelo aplicativo humano usa a mesma rotina, mantendo a autorização/MFA existente. O cálculo é `saída em unidade-base / rendimento em unidade-base × quantidade do componente × fator da unidade / (1 − waste_percent)`, arredondado a seis casas decimais. Subpreparações são consumidas como itens de estoque, sem baixar seus ingredientes novamente. Componentes específicos da outra loja são excluídos. Receita inativa, rendimento inválido, área ambígua, saldo insuficiente ou falha de qualquer ingrediente revertem tudo.

### Transferências

Usar `kind: "transfer"`, `step` e `data` abaixo. Cada etapa requer solicitação/evidência operacional própria e suficiente; a instalação não autoriza criar, aprovar, despachar ou receber pedidos automaticamente. Não fabricar IDs de mensagem para executar várias etapas. O grupo de origem é sempre o de Preparação; a direção Sherwood ↔ Natick é explícita no pedido.

| `step` | Campos de `data` |
| --- | --- |
| `create` | `requesting_location_id` (destino), `fulfilling_location_id` (origem), `needed_on`, `notes` opcional; `lines`: `inventory_item_id`, `item_unit_id`, `quantity` |
| `approve` | `request_id`; `lines`: `request_line_id`, `quantity` |
| `dispatch` | `request_id`, `notes` opcional; `lines`: `request_line_id`, `from_storage_area_id`, `quantity` |
| `receive` | `request_id`, `transfer_id`, `notes` opcional; `lines`: `transfer_line_id`, `to_storage_area_id`, `quantity` |

`create` retorna pedido e IDs das linhas. `dispatch` retorna `document_id` (transferência) e, nos movimentos, `sourceId` (linha de expedição). O recebimento usa esses IDs exatos. A expedição baixa a origem; o recebimento dá entrada no destino. Recebimentos parciais mantêm o pedido aberto. Quantidades acima do aprovado/enviado e áreas de outra loja são recusadas. Somente pedidos criados por este fluxo/grupo podem ser avançados pelo agente. Itens fora de Batch Prep e seus componentes são recusados.

A máquina usa uma especialização privada da função instalada de transferências. São preservados os bloqueios, limites, estado e validações de saldo. A função humana não recebe exceções para a máquina. Mudanças futuras na função humana devem revisar/recriar a especialização em nova migração e executar os testes novamente.

## Confirmação e repetição

`--check` executa a mesma transação e faz ROLLBACK; retorna `committed:false` e nunca autoriza ✅. Usar somente em base isolada durante a validação; não presumir autorização para testes que bloqueiem estoque real.

Sem `--check`, confirmar somente com `committed:true`, IDs e movimentos verificados. A repetição da mensagem original com conteúdo idêntico retorna os mesmos registros, sem nova baixa. O mesmo lote do aplicativo também é protegido caso o comando seja reenviado com outra chave. Alterações após gravação, evidência ausente ou divergência entre registros e movimentos exigem reconciliação com Leonardo. Nunca contornar usando outra chave/mensagem ou recriar registros apagados.

Antes de processar mensagens antigas, conferir lançamentos anteriores fora deste mecanismo. A nova chave de deduplicação não identifica automaticamente duplicidades históricas criadas por outros caminhos. Nenhum backfill é autorizado. O lote histórico incompleto precisa de reconciliação separada.

No grupo, preservar todas as regras de silêncio e de perguntas por dados faltantes. Sucesso de produção: somente ✅, após commit. Falha técnica: sem ✅, sem diagnóstico no grupo; seguir o canal privado autorizado. O adaptador não envia mensagens ou reações.

## Instalação pendente e limites da evidência

1. Revisar a migração `20261021124641_atomic_preparation_and_whatsapp_service.sql`, executar os testes abaixo e conferir as funções atuais antes da aplicação autorizada. Não fazer reset/replay em produção.
2. Aplicar a migração somente no destino autorizado. `doogy_prep_service` nasce NOLOGIN, sem acesso direto a tabelas/SQL geral e com duas funções permitidas: catálogo e registro. Provisionar uma identidade LOGIN separada, membro somente desse papel, com segredo gerado e guardado em arquivo privado. A migração não cria senha nem altera credenciais existentes.
3. Instalar `scripts/whatsapp-preparation.py` no caminho acima e disponibilizar `psycopg2` ao Python do servidor. Preservar o arquivo de configuração privado; nunca incluí-lo no Git. O adaptador não aceita caminhos de configuração ou comandos SQL fornecidos pelo modelo.
4. Acrescentar estas instruções ao workspace do especialista sem sobrescrever seus procedimentos. Conferir a política real de ferramentas. Não ampliar permissões globais, liberar outros agentes ou contornar uma ferramenta bloqueada para chamar o adaptador.
5. Em um runtime isolado do agente, confirmar o formato nativo de imagens/remetente, sua capacidade de chamar o adaptador e a confirmação após persistência. Não enviar mensagens a grupos reais. O teste automatizado local cobre o adaptador com histórico nativo sintético e o banco, mas não executa um turno do modelo no gateway OpenClaw ativo, nem testa visão de uma foto real ou reação no WhatsApp.

Reprodução: `PGLITE_MODULE_PATH=/caminho/pglite/dist/index.js node supabase/tests/whatsapp-preparation.mjs` e `python3 -B -m unittest discover -s tests/backup -p 'test_whatsapp_preparation.py' -v`, a partir da raiz do aplicativo. Usar `@electric-sql/pglite@0.3.14`. O teste não usa credenciais nem dados de produção. O PGlite serializa consultas; esta evidência não substitui um teste de contenção com conexões independentes no PostgreSQL do runtime isolado.

Reversão: suspender gravações do adaptador e retirar seu acesso antes de restaurar o aplicativo. Preservar lotes, consumos, transferências, auditoria e chaves gravadas. Não restaurar o caminho antigo de conclusão que grava somente a saída e não apagar ledger/baixas para "voltar" a versão. Uma reversão funcional exige migração revisada, sem desfazer estoque confirmado.
