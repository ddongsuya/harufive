import test from 'node:test';
import assert from 'node:assert/strict';
import { policyDialog } from '../public/game/policy-views.js';
import { auditMarkup } from './helpers/markup-source.mjs';

test('policy notices remain read-only and expose only the known contact link', () => {
  for (const kind of ['terms', 'privacy', 'data']) {
    const page = policyDialog(kind);
    assert.ok(page.title && page.subtitle);
    const { nodes, issues } = auditMarkup(page.body);
    assert.deepEqual(issues, []);
    assert.equal(nodes.filter(node => ['form', 'input', 'textarea', 'select', 'button', 'script', 'iframe', 'img', 'link'].includes(node.tag)).length, 0);
    assert.deepEqual(nodes.filter(node => node.tag === 'a').map(node => node.attrs.href), ['mailto:limjm900202@gmail.com']);
    assert.ok(nodes.filter(node => node.tag === 'strong').length >= 5);
    assert.equal(nodes.some(node => Object.keys(node.attrs).some(attribute => /^on/i.test(attribute))), false);
  }
});

test('unrecognized policy selectors cannot inject content or choose object properties', () => {
  const coercion = { toString() { throw new Error('Must not coerce user data'); } };
  for (const kind of [undefined, null, 1, coercion, '', 'constructor', '__proto__', '<img src=x onerror=alert(1)>']) {
    assert.equal(policyDialog(kind), null);
  }
});

test('notices distinguish actual service availability, browser cleanup and pending rights', () => {
  const terms = policyDialog('terms');
  assert.match(terms.subtitle, /정식 이용약관을 확정하기 전/);
  assert.match(terms.body, /만 14세/);
  assert.match(terms.body, /약관 동의나 회원가입이 이루어지지 않아요/);
  const privacy = policyDialog('privacy').body;
  assert.match(privacy, /게임 계정이나 게임 기록을 새로 저장하지 않아요/);
  assert.match(privacy, /접속 정보까지 전혀 처리하지 않는다고 보장하지 않아요/);
  assert.match(privacy, /서버 계정과 기록이 삭제되지는 않아요/);
  assert.match(privacy, /실제 광고|광고 스크립트/);
  const data = policyDialog('data').body;
  assert.match(data, /자기 계정의 탈퇴·삭제를 신청할 수 없어요/);
  assert.match(data, /삭제 요청 접수는 모든 자료의 삭제 완료가 아니에요/);
  assert.match(data, /이메일을 보낸 것만으로 본인 확인이나 삭제가 완료되지는 않아요/);
  assert.match(data, /비밀번호·인증번호·신분증 사본은 보내지 마세요/);
});

test('mutating a returned notice does not alter later public notices', () => {
  const before = policyDialog('privacy');
  const modified = policyDialog('privacy');
  modified.body = '<script>bad()</script>';
  modified.title = '동의 완료';
  assert.deepEqual(policyDialog('privacy'), before);
});
