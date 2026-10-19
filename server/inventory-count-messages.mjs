const messages=new Map([
 ['Invalid count item or unit','An item or unit is no longer available. Your draft is preserved. Review the selected units and retry.'],
 ['Invalid count item','Check the quantities and item issue lengths. Your draft is preserved.'],
 ['Invalid count notes','Count notes must contain at most 4,000 characters. Your draft is preserved.'],
 ['Count changed in another window. Reopen it from History.','This count changed in another window. Your local edits are preserved. Reopen it from History to review the saved version.'],
 ['Only the count creator can resume this draft','Only the count creator can edit or complete this draft.'],
 ['This count is already completed','This count is already completed. Reopen History to view it.'],
 ['The items and sections of a started count cannot change','The count item list changed. Your draft is preserved. Reopen it from History.'],
 ['Invalid count draft','The count draft could not be validated. Your saved draft is preserved.'],
 ['Duplicate count items','The count contains duplicate items. Your saved draft is preserved.'],
 ['Count draft not found','This draft could not be found. Reopen History before retrying.'],
]);
export function countDatabaseMessage(message){return messages.get(message);}
