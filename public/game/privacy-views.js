const STATES = Object.freeze({pending:'동의 확인 대기',active:'이용 중',withdrawn:'동의 철회',deletion_pending:'삭제 처리 대기',deleted:'현재 서비스 자료 삭제됨'});
const text = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const contact = '<a class="text-link support-contact" href="mailto:limjm900202@gmail.com"><span>운영 문의</span><span>limjm900202@gmail.com</span></a>';
const stateName = state => STATES[state]||'상태 확인 필요';
const button = (action,label,{disabled=false,extra='',kind='secondary'}={}) =>
  `<button class="btn ${kind}" data-action="${action}" ${extra} ${disabled?'disabled':''}>${label}</button>`;

export function guardianPage(){
  return `<section class="privacy-page" aria-labelledby="guardian-title">
    <div class="privacy-page-heading"><span class="tag neutral">만 14세 이상 이용 안내</span><h1 id="guardian-title">하루다섯은<br>만 14세 이상을 위한 게임이에요.</h1><p>만 14세 미만 어린이의 가입과 이용은 제공하지 않아요.</p></div>
    <div class="card privacy-intro"><span class="privacy-mark" aria-hidden="true">♡</span><div><h2>가입과 간편 로그인은 아직 준비 중이에요</h2><p>연령 확인 절차를 준비하고 있어요.</p></div></div>
    <section class="card privacy-section"><h2>기존 기록의 관리</h2><p>기존 계정의 기록 확인과 삭제 등 정보 관리는 나의 정보 관리에서 확인해 주세요.</p><div class="privacy-actions">${button('privacy-open','나의 정보 관리')}</div></section>
    <p class="privacy-small">이용 연령은 서비스의 가입·이용 기준이에요. 게임물 등급은 아직 확정되지 않았어요.</p><div class="privacy-footer">${contact}${button('privacy-back','게임으로 돌아가기',{kind:'ghost'})}</div>
  </section>`;
}

export function privacyPage({signedIn=false,loading=false,busy=false,status=null,children=[],hasMore=false,selected=null,error='',notice='',uncertain=false,reauthentication=null}={}){
  const ready=!!status&&signedIn&&!loading&&!error;
  const selectedChild=children.find(child=>child.childAccountId===selected);
  const showChildren=signedIn&&children.length>0;
  const childAllowed=ready&&status.capabilities?.childManagement===true&&!busy&&!uncertain;
  const selfExport=ready&&status.capabilities?.selfExport===true&&!busy&&!uncertain;
  const permissionNotice=!signedIn
    ?'<p>하루다섯은 만 14세 이상을 위한 게임이에요. 간편 로그인과 새 계정 가입은 아직 열리지 않았어요. 연령 확인 절차를 준비하고 있어요.</p>'
    :'<p>중요한 정보 관리에는 최근에 확인한 로그인이 필요해요. 다른 사람과 함께 쓰는 기기라면 이용 후 로그아웃해 주세요.</p>';
  return `<section class="privacy-page" aria-labelledby="privacy-title">
    <div class="privacy-page-heading"><span class="tag neutral">나의 기록과 권리</span><h1 id="privacy-title">나의 정보 관리</h1><p>나의 기록을 살펴보고,<br>정보 관리 권한을 확인해요.</p></div>
    ${permissionNotice}
    ${signedIn?`<section class="card privacy-section privacy-reauth" aria-labelledby="reauth-title"><h2 id="reauth-title">최근 본인 확인</h2><p>기록을 받거나 동의를 관리하기 전에 현재 계정에 연결된 로그인으로 다시 확인해요. 확인을 마친 뒤에도 요청할 작업은 직접 선택해 주세요.</p><div class="privacy-actions">${[['kakao','카카오'],['google','Google'],['naver','네이버']].map(([id,label])=>button('auth-reauth',`${label}로 다시 확인`,{disabled:busy||!reauthentication?.enabled||!reauthentication.providers?.some(provider=>provider.id===id&&provider.enabled),extra:`data-provider="${id}"`})).join('')}</div><p class="privacy-small">${reauthentication?.enabled?'현재 계정에 연결된 로그인만 선택할 수 있어요.':'최근 본인 확인을 연결하고 있어요. 지금은 이 화면에서 새로 확인할 수 없어요.'}</p></section>`:''}
    ${loading?'<div class="privacy-notice" role="status">현재 계정의 정보 관리 권한을 확인하고 있어요…</div>':''}
    ${error?`<div class="privacy-notice warning" role="alert">${text(error)}</div>`:''}
    ${notice?`<div class="privacy-notice" role="status">${text(notice)}</div>`:''}
    ${uncertain?'<div class="privacy-notice warning" role="status">요청이 접수됐는지 아직 확인하지 못했어요. 같은 요청을 자동으로 다시 보내지 않아요. 아래에서 현재 상태를 확인해 주세요.</div>':''}
    ${signedIn?`<div class="privacy-toolbar">${button('privacy-refresh',busy?'처리 중…':'현재 상태 다시 확인',{disabled:loading||busy})}<button class="text-link" data-action="auth-logout">로그아웃</button></div>`:''}
    <div class="privacy-columns"><section class="card privacy-section"><div class="privacy-section-title"><h2>내 기록</h2>${ready?`<span class="tag neutral">${text(stateName(status.account?.state))}</span>`:''}</div><p>게임 기록과 보유한 친구·아이템 정보를 파일로 받을 수 있어요. 받은 파일은 직접 안전하게 보관해 주세요.</p>${button('privacy-export','내 기록 다운로드',{disabled:!selfExport,extra:'data-target="self"'})}<p class="privacy-small">${!signedIn?'로그인 후 이용할 수 있어요.':!ready?'현재 계정 확인이 끝나면 이용할 수 있어요.':'현재 계정에 연결된 기록만 담아요.'}</p></section>
    <section class="card privacy-section"><h2>내 계정 탈퇴·삭제</h2><p>탈퇴 후에도 본인 확인을 거쳐 처리 상태를 확인할 수 있도록 준비하고 있어요. 현재 화면에서는 자기 계정의 탈퇴·삭제를 신청할 수 없어요.</p>${button('privacy-self-delete','본인 재확인 절차 준비 중',{disabled:true})}<p class="privacy-small">문의에 비밀번호나 인증번호를 보내지 마세요.</p></section></div>
    ${showChildren?`<section class="card privacy-section"><div class="privacy-section-title"><div><span class="eyebrow">기존 연결 정보 관리</span><h2>연결된 어린이</h2></div></div><p>현재 로그인한 보호자에게 이미 연결되어 서버에서 확인된 계정만 보여요. 새로운 보호자 연결은 제공하지 않아요.</p>
      ${ready&&status.capabilities?.childManagement===true?`<div class="privacy-child-list" role="group" aria-label="관리할 어린이 선택">${children.map((child,index)=>`<button class="privacy-child ${selected===child.childAccountId?'selected':''}" data-action="privacy-child" data-child="${text(child.childAccountId)}" aria-pressed="${selected===child.childAccountId}" ${busy?'disabled':''}><span><strong>${text(child.label)}</strong><small>연결 계정 ${index+1}</small></span><span class="tag neutral">${text(stateName(child.state))}</span></button>`).join('')}</div>`:'<div class="privacy-empty">현재 계정의 관리 권한을 다시 확인해 주세요.</div>'}
      ${hasMore?'<p class="privacy-small">표시할 수 있는 계정 수를 넘었어요. 나머지 연결은 운영 문의로 알려 주세요.</p>':''}
      ${selectedChild?`<div class="privacy-child-detail" aria-label="선택한 어린이 정보"><div class="privacy-section-title"><h3>${text(selectedChild.label)}</h3><span class="tag neutral">${text(stateName(selectedChild.state))}</span></div><p>${selectedChild.state==='deletion_pending'?'삭제 요청을 접수했어요. 현재 이용은 중단됐으며 자료 삭제는 대기 중이에요.':selectedChild.state==='withdrawn'?'동의를 철회해 게임 이용이 중단됐어요. 보호자는 기록 확인과 삭제 요청을 계속할 수 있어요.':'이 계정의 기록을 확인하거나 동의를 관리할 수 있어요.'}</p><div class="privacy-actions">${button('privacy-export','어린이 기록 다운로드',{disabled:!childAllowed,extra:'data-target="child"'})}${button('privacy-withdraw','동의 철회',{disabled:!childAllowed||selectedChild.state!=='active',kind:'privacy-danger'})}${button('privacy-delete',selectedChild.state==='deletion_pending'?'삭제 요청 접수됨':'기록 삭제 요청',{disabled:!childAllowed||!['active','withdrawn'].includes(selectedChild.state),kind:'privacy-danger'})}</div><p class="privacy-small">삭제 요청은 즉시 모든 자료가 삭제됐다는 뜻이 아니에요.</p></div>`:''}
    </section>`:''}<div class="privacy-footer">${button('guardian-open','이용 연령 안내',{kind:'ghost'})}${contact}${button('privacy-back','게임으로 돌아가기',{kind:'ghost'})}</div>
  </section>`;
}
