import {api} from './cloud.js';
export const loginRoutes=['login','recover','request-access'];
export function createLoginUI({icon,goto,icons,onLogin}){
  const google='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-4V7.3H3a10 10 0 0 0 0 9.4L6.4 14Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.3L6.4 10C7.2 7.7 9.4 5.9 12 5.9Z"/></svg>';
  function page(mode='login'){
    const login=mode==='login',recovery=mode==='recover';
    return `<main class="login-page">
      <section class="login-content" aria-label="Acesso ao workspace">
        <header class="login-brand"><img src="/brand/hot-doogy-wordmark.svg" alt="HOT DOOGY"><span>OPERATIONS</span></header>
        <div class="login-form-wrap">
          ${!login?'<button class="login-back" data-action="login-back">'+icon('arrow-left')+' Voltar ao login</button>':''}
          <span class="login-eyebrow">SEU WORKSPACE</span>
          <h1>${login?'Bom ter você<br>de volta.':recovery?'Esqueceu sua senha?':'Faça parte da operação.'}</h1>
          <p class="login-subtitle">${login?'Tudo pronto para mais um dia de Hot Doogy.':recovery?'Recupere o acesso ao seu workspace.':'O acesso é destinado à equipe Hot Doogy.'}</p>
          ${false?`<button type="button" class="login-google" data-action="login-google">${google}<span>Continuar com Google</span></button><div class="login-divider"><span>ou entre com seu e-mail</span></div>`:''}
          <form id="login-form" data-login-mode="${mode}">
            <label for="login-email">E-mail</label>
            <div class="login-input">${icon('mail')}<input id="login-email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="voce@hotdoogy.com" required></div>
            ${login?`<div class="login-password-label"><label for="login-password">Senha</label><button type="button" class="login-text-button" data-action="login-recover">Esqueci minha senha</button></div><div class="login-input">${icon('lock-keyhole')}<input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Digite sua senha" required><button type="button" class="login-eye" data-action="login-toggle-password" aria-label="Mostrar senha" aria-pressed="false">${icon('eye')}</button></div>`:''}
            <p id="login-feedback" class="login-feedback" role="status" aria-live="polite" hidden></p>
            <button type="submit" class="login-submit">${login?'Entrar':recovery?'Recuperar acesso':'Solicitar acesso'}${icon('arrow-right')}</button>
          </form>
          ${login?'<p class="login-access">Ainda não tem acesso? <button class="login-text-button" data-action="login-request">Solicitar acesso</button></p>':''}
          
        </div>
        <footer class="login-footer"><span>© ${new Date().getFullYear()} Hot Doogy</span><span>Feito para a nossa operação.</span></footer>
      </section>
      <aside class="login-visual" aria-label="Hot Doogy Operations">
        <div class="login-visual-top"><span><i></i> HOT DOOGY OPERATIONS</span>${icon('sparkles')}</div>
        <div class="login-visual-heading"><h2>Sua operação.<br><em>No ponto.</em></h2><p>Da preparação à venda,<br>cada detalhe no seu lugar.</p></div>
        <div class="login-orbit" aria-hidden="true"></div>
        <img class="login-product" src="/brand/hot-dog-cutout.png" alt="Hot dog Hot Doogy com mostarda">
        <div class="login-floating-note">${icon('chef-hat')}<div><strong>Feito com cuidado.</strong><span>Gerenciado com clareza.</span></div></div>
        <div class="login-visual-footer"><div>${icon('store')} Sherwood Plaza <span>·</span> Natick Mall</div><span>UM TIME. UMA OPERAÇÃO.</span></div>
      </aside>
    </main>`;
  }
  function feedback(text){const el=document.querySelector('#login-feedback');if(el){el.hidden=false;el.textContent=text;}}
  async function submit(form){
    if(form.id!=='login-form'||!form.reportValidity())return false;
    const button=form.querySelector('[type="submit"]');if(button.disabled)return false;button.disabled=true;const label=button.innerHTML;button.textContent='Entrando…';feedback('Verificando seu acesso…');
    try{
      if(form.dataset.loginMode!=='login'){feedback('Fale com o administrador da equipe para recuperar ou solicitar acesso.');return true;}
      const session=await api('/api/auth/login',{email:form.email.value,password:form.password.value});
      form.password.value='';button.textContent='Abrindo operação…';feedback('Acesso confirmado. Carregando os dados da operação…');await onLogin(session);
    }catch(error){feedback(error.message);}finally{button.disabled=false;button.innerHTML=label;}
    return true;
  }
  const actions={
    'login-back':()=>goto('login'),
    'login-recover':()=>goto('recover'),
    'login-request':()=>goto('request-access'),
    
    'login-google':()=>feedback('O acesso com Google ainda não está conectado. Use “Explorar demonstração” para conhecer o workspace.'),
    'login-toggle-password':el=>{const input=document.querySelector('#login-password'),show=input.type==='password';input.type=show?'text':'password';el.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');el.setAttribute('aria-pressed',String(show));el.innerHTML=icon(show?'eye-off':'eye');icons();}
  };
  return {page,submit,actions};
}
