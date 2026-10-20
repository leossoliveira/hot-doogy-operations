# Regras persistentes do extrator de invoices

## Recibos de compra (20/10/2026)

Recibos de compra discriminados são aceitos como `document_type=invoice` para revisão humana quando identificam vendedor, data, produtos/serviços e total, mesmo sem invoice formal. Usar o número do recibo como número do documento, quando presente. Registrar aviso de que é recibo aceito no lugar de invoice; manter campos ausentes nulos. Comprovantes de entrega continuam excluídos. Não confundir total da compra com dinheiro entregue ou troco; extrair ajustes de arredondamento uma única vez e não registrar pagamento automaticamente. Esta regra está nas instruções compartilhadas dos dois provedores de extração.
