# Regras persistentes do extrator de invoices

## Recibos de compra (20/10/2026)

Recibos de compra discriminados são aceitos como `document_type=invoice` para revisão humana quando identificam vendedor, data, produtos/serviços e total, mesmo sem invoice formal. Usar o número do recibo como número do documento, quando presente. Registrar aviso de que é recibo aceito no lugar de invoice; manter campos ausentes nulos. Comprovantes de entrega continuam excluídos. Não confundir total da compra com dinheiro entregue ou troco; extrair ajustes de arredondamento uma única vez e não registrar pagamento automaticamente. Esta regra está nas instruções compartilhadas dos dois provedores de extração.

## Aceitação ampla na análise (20/10/2026)

Por solicitação de Leonardo, a análise aceita qualquer comprovante, recibo ou invoice, inclusive recibos simples, manuscritos, serviços, transferências, comprovantes de cartão e de entrega. Esta regra substitui a exigência anterior de recibo discriminado para análise. Preservar a natureza do documento: invoice para documentos financeiros de compra/serviço; receiving_proof para entrega; other para pagamento isolado; uncertain para natureza indefinida. Dados ausentes ficam nulos, sem inventar produtos a partir do valor pago. Baixa confiança gera aviso para revisão. Comprovantes de pagamento devem alertar para possível duplicação de despesa já faturada. Continuam vigentes a conferência humana para cadastro financeiro, os limites de arquivo/completude e o bloqueio de ações automáticas. As instruções compartilhadas e a validação dos dois provedores implementam esta regra; este arquivo sozinho não altera o agente em produção.
