import {api} from './cloud.js';
export const loginRoutes=['login','recover','request-access','mfa'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createLoginUI({icon,goto,icons,onLogin}){
  let pending=null,enrollment=null,generation=0,busy=false;
  async function accept(value,route){
    generation++;enrollment=null;
    if(value?.mfa?.required){pending=value;goto('mfa');return;}
    pending=null;await onLogin(value,route);
  }
  function mfaForm(){
    const setup=pending.mfa.step==='enroll',factors=pending.mfa.factors||[];
    return `<div class="mfa-intro"><p>Owners and administrators must use two-step verification to access this workspace.</p></div>
      ${setup&&!enrollment?`<p class="mfa-help">Use an authenticator app, such as Google Authenticator, Microsoft Authenticator, or 1Password.</p><button type="button" class="login-submit" data-action="mfa-enroll">Set up authenticator ${icon('arrow-right')}</button>`:''}
      ${enrollment?`<div class="mfa-enrollment"><p>1. Scan this QR code with your authenticator app.</p><img class="mfa-qr" src="${escape(enrollment.qrCode)}" alt="Scan to set up your HOT DOOGY authenticator"><details><summary>Can’t scan the code?</summary><p>Enter this setup key in your authenticator app:</p><code class="mfa-secret">${escape(enrollment.secret)}</code></details><p>2. Enter the six-digit code from the app.</p></div>`:''}
      ${!setup||enrollment?`<form id="mfa-form">
        ${factors.length>1?`<label for="mfa-factor">Authenticator</label><select id="mfa-factor" name="factorId" class="mfa-factor">${factors.map(f=>`<option value="${escape(f.id)}">${escape(f.name)}</option>`).join('')}</select>`:''}
        ${!setup&&!factors.length?'<p class="mfa-help">No supported authenticator is available. Contact your administrator to recover access.</p>':`<label for="mfa-code">Verification code</label><div class="login-input">${icon('lock-keyhole')}<input id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" type="text" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" aria-describedby="mfa-code-help" required></div><p id="mfa-code-help" class="mfa-help">Codes refresh every 30 seconds.</p><button type="submit" class="login-submit">${setup?'Verify and enable':'Verify and sign in'} ${icon('arrow-right')}</button>`}
      </form>`:''}
      <p id="login-feedback" class="login-feedback" role="status" aria-live="polite" hidden></p>
      <details class="mfa-recovery"><summary>Lost access to your authenticator?</summary><p>Contact your workspace administrator. They must verify your identity before resetting your authenticator. Your password alone cannot bypass this step.</p></details>
      <button type="button" class="login-back" data-action="mfa-cancel">${icon('arrow-left')} Back to sign in</button>`;
  }
  function page(mode='login'){
    const mfa=mode==='mfa'&&pending;
    if(mode==='mfa'&&!pending)mode='login';
    const login=mode==='login',recovery=mode==='recover';
    return `<main class="login-page">
      <section class="login-content" aria-label="Workspace access">
        <header class="login-brand"><img src="/brand/hot-doogy-wordmark.svg" alt="HOT DOOGY"><span>OPERATIONS</span></header>
        <div class="login-form-wrap">
          <span class="login-eyebrow">YOUR WORKSPACE</span>
          <h1>${mfa?(pending.mfa.step==='enroll'?"Secure your<br>account.":"Verify it’s<br>you."):login?"Welcome<br>back.":recovery?"Forgot your password?":"Join the team."}</h1>
          <p class="login-subtitle">${mfa?escape(pending.user.email):login?"Ready for another day at Hot Doogy.":recovery?"Your manager resets it for you.":"Access is set up by your manager."}</p>
          ${mfa?mfaForm():!login?`<div class="login-help">${recovery?`<p>Passwords are reset by your store manager or an administrator. They confirm it’s you before resetting, so nothing is sent from this screen.</p><p>Ask them in person or in the team chat, then sign in here with the new password.</p>`:`<p>Your store manager or an administrator adds Hot Doogy team members to the workspace with their work email.</p><p>Ask them to add you. Once you’re in, sign in here with that email.</p>`}<button type="button" class="login-back" data-action="login-back">${icon('arrow-left')} Back to sign in</button></div>`:`
          <form id="login-form" data-login-mode="login">
            <label for="login-email">Email</label>
            <div class="login-input">${icon('mail')}<input id="login-email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@hotdoogy.com" required></div>
            <div class="login-password-label"><label for="login-password">Password</label><button type="button" class="login-text-button" data-action="login-recover">Forgot password?</button></div><div class="login-input">${icon('lock-keyhole')}<input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required><button type="button" class="login-eye" data-action="login-toggle-password" aria-label="Show password" aria-pressed="false">${icon('eye')}</button></div>
            <p id="login-feedback" class="login-feedback" role="status" aria-live="polite" hidden></p>
            <button type="submit" class="login-submit">Sign in${icon('arrow-right')}</button>
          </form>
          `}
          ${login?"<p class=\"login-access\">Don’t have access yet? <button type=\"button\" class=\"login-text-button\" data-action=\"login-request\">Request access</button></p>":''}
          
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
    if(!['login-form','mfa-form'].includes(form.id)||!form.reportValidity()||busy)return false;
    const button=form.querySelector('[type="submit"]');if(button.disabled)return false;
    busy=true;button.disabled=true;const label=button.innerHTML,version=generation;
    button.textContent=form.id==='mfa-form'?"Verifying…":"Signing in…";feedback("Checking your access…");
    try{
      if(form.id==='mfa-form'){
        const factorId=form.elements.factorId?.value||pending.mfa.factors?.[0]?.id||enrollment?.id;
        const value=await api('/api/auth/mfa/verify',{factorId,code:form.elements.code.value});
        form.elements.code.value='';if(version===generation)await accept(value);return true;
      }
      const value=await api('/api/auth/login',{email:form.email.value,password:form.password.value});
      form.password.value='';
      if(version!==generation)return true;
      if(!value.mfa?.required){button.textContent="Opening your workspace…";feedback("You’re signed in. Loading your workspace data…");}
      await accept(value);
    }catch(error){
      if(version===generation){
        if(form.id==='mfa-form'&&error.status===401){pending=null;enrollment=null;generation++;goto('login');}
        feedback(error.message);
      }
    }finally{busy=false;button.disabled=false;button.innerHTML=label;}
    return true;
  }
  const actions={
    'mfa-enroll':async el=>{
      if(busy||!pending)return;busy=true;el.disabled=true;const version=generation;
      try{const value=await api('/api/auth/mfa/enroll',{});if(version===generation){enrollment=value;goto('mfa');}}
      catch(error){if(version===generation){if(error.status===401){pending=null;enrollment=null;generation++;goto('login');}feedback(error.message);}}
      finally{busy=false;el.disabled=false;}
    },
    'mfa-cancel':async()=>{generation++;pending=null;enrollment=null;try{await api('/api/auth/logout',{});}finally{goto('login');}},
    'login-back':()=>goto('login'),
    'login-recover':()=>goto('recover'),
    'login-request':()=>goto('request-access'),
    'login-toggle-password':el=>{const input=document.querySelector('#login-password'),show=input.type==='password';input.type=show?'text':'password';el.setAttribute('aria-label',show?"Hide password":"Show password");el.setAttribute('aria-pressed',String(show));el.innerHTML=icon(show?'eye-off':'eye');icons();}
  };
  return {page,submit,actions,accept,get pending(){return !!pending;}};
}
