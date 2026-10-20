# Preferências de trabalho

## Commits locais

- Ao concluir cada alteração solicitada, verifique o resultado e crie um commit local com uma descrição clara, sem exigir nova confirmação para o commit.
- Inclua somente os arquivos relativos à alteração concluída. Preserve mudanças anteriores não relacionadas e nunca inclua credenciais.
- Não crie commits de alterações incompletas ou com verificações necessárias pendentes; informe o impedimento.
- Criar um commit local não autoriza envio ao GitHub. Não execute push nem publique imediatamente; siga a autorização descrita abaixo.

## Mudanças no banco Supabase

- Registrar cada nova mudança de estrutura, função ou permissão em uma migração SQL em `supabase/migrations/`, criada pela CLI Supabase e validada em ambiente isolado.
- Incluir a migração no mesmo commit local da alteração correspondente do aplicativo, após as verificações necessárias.
- Preservar migrações já aplicadas. Scripts históricos em `database/` não substituem uma nova migração.
- Não aplicar SQL no banco remoto apenas por criar um commit ou publicar o front end. A aplicação exige escopo autorizado e verificação do histórico e do resultado.
- Consultar `supabase/README.md` para os limites do histórico importado. Não executar replay, reset ou reparo automático na produção.

## Envio de alterações ao GitHub

- Ao concluir as alterações solicitadas, prepare e verifique o resultado localmente.
- Antes de enviar alterações ao GitHub, apresente um resumo breve do que será enviado e pergunte se o usuário autoriza o envio.
- Aguarde autorização explícita antes de executar `git push` ou publicar alterações por API, MCP ou interface do GitHub.
- Uma autorização vale para o conjunto de alterações apresentado; não autoriza envios futuros automaticamente.
- Se o usuário já pediu explicitamente o envio daquele conjunto de alterações, essa solicitação conta como autorização, sem necessidade de perguntar novamente.
- Não configure envio automático de alterações locais sem uma nova solicitação explícita do usuário.

## Comprovantes de recebimento e invoices

- Recibos de compra discriminados (cupom de caixa, purchase receipt ou sales receipt) são aceitos como invoice para revisão humana, inclusive quando o fornecedor não emite invoice formal. Devem identificar vendedor, data, produtos/serviços e total da compra. Usar o número do recibo quando disponível, sem inventar campos ausentes; dinheiro entregue e troco não são despesas. Isso não inclui comprovantes de entrega/recebimento nem autoriza aprovação ou pagamento automático.

- Comprovante de recebimento, canhoto, delivery receipt, pedido e confirmação de entrega não são automaticamente invoices. O recebimento deve ser registrado independentemente do documento financeiro.
- Não criar invoice nem armazenar comprovante em `invoice-documents` apenas porque foi enviado no fluxo de recebimento. Confirmar a natureza fiscal/financeira do documento; em caso de dúvida, solicitar identificação antes de cadastrar como invoice.
- Comprovantes de recebimento não devem ser enviados ao Storage. Uma autorização de recebimento, conferência ou entrada de estoque não autoriza a classificação como invoice.
- Novos invoices exigem classificação explícita `document_kind=invoice`. Anexos exigem conferência humana autenticada, registrada para o SHA-256 e tamanho do arquivo antes do upload. Não declarar a conferência sem inspecionar o documento financeiro original. A classificação não é reconhecimento automático do conteúdo.
- Correções e exclusões de documentos não devem apagar recebimentos, pagamentos ou movimentações de estoque por consequência. Identificar os arquivos e os vínculos exatos antes da limpeza.
