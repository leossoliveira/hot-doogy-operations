import {api} from './cloud.js';
export const loginRoutes=['login','recover','request-access'];
export function createLoginUI({icon,goto,icons,onLogin}){
  const google='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-4V7.3H3a10 10 0 0 0 0 9.4L6.4 14Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.3L6.4 10C7.2 7.7 9.4 5.9 12 5.9Z"/></svg>';
  function page(mode='login'){
    const login=mode==='login',recovery=mode==='recover';
    return `<main class="login-page">
      <section class="login-content" aria-label="Workspace access">
        <header class="login-brand"><img src="/brand/hot-doogy-wordmark.svg" alt="HOT DOOGY"><span>OPERATIONS</span></header>
        <div class="login-form-wrap">
          ${!login?'<button class="login-back" data-action="login-back">'+icon('arrow-left')+" Back to sign in</button>":''}
          <span class="login-eyebrow">YOUR WORKSPACE</span>
          <h1>${login?"Welcome<br>back.":recovery?"Forgot your password?":"Join the team."}</h1>
          <p class="login-subtitle">${login?"Ready for another day at Hot Doogy.":recovery?"Recover access to your workspace.":"Access is for Hot Doogy team members."}</p>
          ${false?`<button type="button" class="login-google" data-action="login-google">${google}<span>Continue with Google</span></button><div class="login-divider"><span>or sign in with your email</span></div>`:''}
          <form id="login-form" data-login-mode="${mode}">
            <label for="login-email">Email</label>
            <div class="login-input">${icon('mail')}<input id="login-email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@hotdoogy.com" required></div>
            ${login?`<div class="login-password-label"><label for="login-password">Password</label><button type="button" class="login-text-button" data-action="login-recover">Forgot password?</button></div><div class="login-input">${icon('lock-keyhole')}<input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required><button type="button" class="login-eye" data-action="login-toggle-password" aria-label="Show password" aria-pressed="false">${icon('eye')}</button></div>`:''}
            <p id="login-feedback" class="login-feedback" role="status" aria-live="polite" hidden></p>
            <button type="submit" class="login-submit">${login?"Sign in":recovery?"Recover access":"Request access"}${icon('arrow-right')}</button>
          </form>
          ${login?"<p class=\"login-access\">Don’t have access yet? <button class=\"login-text-button\" data-action=\"login-request\">Request access</button></p>":''}
          
        </div>
        <footer class="login-footer"><span>© ${new Date().getFullYear()} Hot Doogy</span><span>Built for our team.</span></footer>
      </section>
      <aside class="login-visual" aria-label="Hot Doogy Operations">
        <div class="login-visual-top"><span><i></i> HOT DOOGY OPERATIONS</span>${icon('sparkles')}</div>
        <div class="login-visual-heading"><h2>Your operations.<br><em>Right on point.</em></h2><p>From prep to sale,<br>every detail in place.</p></div>
        <div class="login-orbit" aria-hidden="true"></div>
        <img class="login-product" src="/brand/hot-dog-cutout.png" alt="Hot Doogy hot dog with mustard">
        <div class="login-floating-note">${icon('chef-hat')}<div><strong>Made with care.</strong><span>Managed with clarity.</span></div></div>
        <div class="login-visual-footer"><div>${icon('store')} Sherwood Plaza <span>·</span> Natick Mall</div><span>ONE TEAM. ONE OPERATION.</span></div>
      </aside>
    </main>`;
  }
  function feedback(text){const el=document.querySelector('#login-feedback');if(el){el.hidden=false;el.textContent=text;}}
  async function submit(form){
    if(form.id!=='login-form'||!form.reportValidity())return false;
    const button=form.querySelector('[type="submit"]');if(button.disabled)return false;button.disabled=true;const label=button.innerHTML;button.textContent="Signing in…";feedback("Checking your access…");
    try{
      if(form.dataset.loginMode!=='login'){feedback("Contact your team administrator to recover or request access.");return true;}
      const session=await api('/api/auth/login',{email:form.email.value,password:form.password.value});
      form.password.value='';button.textContent="Opening your workspace…";feedback("You’re signed in. Loading your workspace data…");await onLogin(session);
    }catch(error){feedback(error.message);}finally{button.disabled=false;button.innerHTML=label;}
    return true;
  }
  const actions={
    'login-back':()=>goto('login'),
    'login-recover':()=>goto('recover'),
    'login-request':()=>goto('request-access'),
    
    'login-google':()=>feedback("Google sign-in is not available. Sign in with your email and password."),
    'login-toggle-password':el=>{const input=document.querySelector('#login-password'),show=input.type==='password';input.type=show?'text':'password';el.setAttribute('aria-label',show?"Hide password":"Show password");el.setAttribute('aria-pressed',String(show));el.innerHTML=icon(show?'eye-off':'eye');icons();}
  };
  return {page,submit,actions};
}
