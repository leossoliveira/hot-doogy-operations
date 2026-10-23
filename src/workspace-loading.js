// The initial HTML shell uses the same layout before this module is available.
export function workspaceLoading({label='Loading your workspace…',error=''}={}){
  const escaped=String(label).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  return `<main class="workspace-loading" aria-busy="${!error}"><section class="workspace-loading-main">${error?`<div class="workspace-loading-error" role="alert">${error}</div>`:`<div class="workspace-loading-status" role="status"><span class="workspace-loading-spinner" aria-hidden="true"></span><span class="workspace-loading-label">${escaped}</span></div>`}</section></main>`;
}
