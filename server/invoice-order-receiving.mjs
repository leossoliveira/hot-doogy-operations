// A reviewed invoice confirms delivery, independently of warehouse stock posting.
export function invoiceOrderReceiving(order) {
 const linked=(order.invoices||[]).filter(i=>i.purchaseOrderId===order.id&&i.organizationId===order.organizationId&&i.locationId===order.locationId&&i.supplierId===order.supplierId&&!['draft','cancelled','rejected'].includes(i.status));
 // Multiple invoices may cover separate deliveries: require every active invoice.
 if(!linked.length||!linked.every(i=>i.extraction?.receiving?.status==='received'))return null;
 return linked.map(i=>({...i.extraction.receiving,invoiceId:i.id}));
}
