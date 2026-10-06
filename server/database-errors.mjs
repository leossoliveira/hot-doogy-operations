// Translate known database validation messages without changing stored enum values or records.
const messages=new Map([
 ['Sem permissão para gravar esta operação.','You do not have permission to save this activity.'],
 ['Unidades inválidas.','Invalid units.'],
 ['Cadastro não disponível.','This record is unavailable.'],
 ['Cadastro alterado por outra pessoa. Reabra antes de salvar.','Someone else changed this record. Reopen it before saving.'],
 ['Item alterado por outra pessoa. Reabra antes de salvar.','Someone else changed this item. Reopen it before saving.'],
 ['Não é possível remover unidades já cadastradas; elas preservam o histórico.','Existing units cannot be removed because they preserve historical records.'],
 ['Categoria inválida.','Invalid category.'],
 ['A unidade-base não pode ser alterada após o cadastro.','The base unit cannot be changed after the item is created.'],
 ['Conversão inválida.','Invalid conversion.'],
 ['Unidade inválida.','Invalid unit.'],
 ['A unidade-base deve ter fator 1.','The base unit must have a conversion factor of 1.'],
 ['Unidades de compra e recebimento inválidas.','Invalid ordering or receiving units.'],
 ['Loja não autorizada.','You do not have access to this location.'],
 ['Preço inválido.','Invalid price.'],
 ['O preço deve usar a unidade de compra.','The price must use the ordering unit.'],
 ['Sem permissão para compras.','You do not have permission to manage purchases.'],
 ['Loja ou fornecedor não autorizado.','You do not have access to this location or supplier.'],
 ['Transição de compra inválida.','This order status change is not allowed.'],
 ['Crie primeiro um rascunho.','Create a draft first.'],
 ['Informe os itens da compra.','Add items to the purchase order.'],
 ['Quantidade ou unidade inválida.','Invalid quantity or unit.'],
 ['Item não habilitado nesta loja.','This item is not enabled at this location.'],
 ['Item não disponível neste fornecedor/unidade.','This item is unavailable for the selected supplier and unit.'],
 ['Pedido não autorizado.','You do not have permission to access this order.'],
 ['Informe as quantidades recebidas.','Enter the quantities received.'],
 ['Data de recebimento inválida.','Invalid receiving date.'],
 ['Linha repetida no recebimento.','This receipt contains a duplicate line.'],
 ['Linha não pertence ao pedido.','This line does not belong to the order.'],
 ['Quantidade ou área inválida.','Invalid quantity or storage area.'],
 ['Recebimento excede a quantidade pedida.','The received quantity exceeds the ordered quantity.'],
 ['Contagem vazia.','Enter at least one count.'],
 ['Contagem inválida.','Invalid count. Check the quantity and count unit.'],
 ['Componentes inválidos.','Invalid recipe components.'],
 ['Receita não encontrada.','Recipe not found.'],
 ['Receita alterada. Reabra antes de salvar.','This recipe has changed. Reopen it before saving.'],
 ['Componente inválido.','Invalid recipe component.'],
 ['Preparação indisponível nesta loja.','This prep item is unavailable at this location.'],
 ['Escolha a área de armazenamento da produção.','Choose the production storage area.'],
 ['Unidade de produção inválida.','Invalid production unit.'],
 ['Quantidade inválida.','Invalid quantity.'],
 ['Receita de produção inválida.','Invalid production recipe.'],
 ['Data de conclusão inválida.','Invalid completion date.'],
 ['Lote já concluído ou indisponível.','This batch is already complete or unavailable.'],
 ['Sem permissão para invoices.','You do not have permission to manage invoices.'],
 ['Etapa inválida.','Invalid workflow step.'],
 ['Use a conferência de expedição e recebimento para avançar transferências.','Review shipping and receiving to advance the transfer.'],
 ['Sem permissão.','You do not have permission to perform this action.'],
 ['Comando inválido.','Invalid request.'],
 ['Comando reutilizado com dados diferentes.','This request was already used with different data. Reload and try again.'],
 ['Página inválida.','Invalid page.'],
]);
export function databaseErrorMessage(data){
 if(data?.message?.startsWith('INVOICE_S3_REQUIRED:'))return 'Upload and verify the original invoice document before marking it Approved or Paid.';
 if(data?.code==='40001')return 'This invoice changed. Reload its status before saving.';

 if(messages.has(data?.message))return messages.get(data.message);
 if(data?.code==='42501')return 'You do not have permission to perform this action.';
 if(data?.code==='23505')return 'A record with these details already exists.';
 if(data?.code==='23503')return 'A related record is missing or still in use. Refresh and try again.';
 return 'Unable to complete the database request. Check your entries and try again.';
}
