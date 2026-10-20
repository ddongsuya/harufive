import test from 'node:test';
import assert from 'node:assert/strict';
import { freshReminder, normalizeReminder, shouldOfferReminder, reminderTimeLabel, createCalendarReminder, GAME_URL } from '../legacy/v040/reminders.js';

const uid='haru-reminder-test@daily.local';

test('calendar starts tomorrow in Korea, including midnight and year boundaries',()=>{
  const cases=[
    ['2026-10-19T14:59:59Z','20:00','2026-10-20','20261020T110000Z'],
    ['2026-10-19T15:00:00Z','00:15','2026-10-21','20261020T151500Z'],
    ['2026-12-31T13:00:00Z','08:00','2027-01-01','20261231T230000Z'],
    ['2028-02-28T12:00:00Z','20:00','2028-02-29','20280229T110000Z'],
  ];
  for(const [now,time,day,stamp] of cases){
    const event=createCalendarReminder({uid,now,time});
    assert.equal(event.firstDay,day);
    assert.ok(event.content.includes(`DTSTART:${stamp}\r\n`));
    assert.ok(event.manualText.includes(day+' '+time+' (한국 시간)'));
  }
});

test('export defines one daily series with a start-time display alarm and game link',()=>{
  const event=createCalendarReminder({uid,now:'2026-10-19T01:00:00Z',time:'20:00'});
  const unfolded=event.content.replace(/\r\n /g,'');
  assert.equal(unfolded.match(/BEGIN:VEVENT/g).length,1);
  assert.match(unfolded,/RRULE:FREQ=DAILY\r\n/);
  assert.match(unfolded,/DTEND:20261020T110500Z\r\n/);
  assert.match(unfolded,/BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT0S\r\nDESCRIPTION:/);
  assert.ok(unfolded.includes('URL:'+GAME_URL+'\r\n'));
  assert.ok(unfolded.endsWith('END:VCALENDAR\r\n'));
  for(const line of event.content.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75,'a folded line exceeds RFC 5545 octet length');
  assert.ok(!event.content.includes('\ufffd'),'Korean UTF-8 characters must remain intact');
  assert.ok(!event.content.replace(/\r\n/g,'').includes('\n'),'all content lines must use CRLF');
});

test('reopening prepared instructions retains the date and UID of the original series',()=>{
  const first=createCalendarReminder({uid,now:'2026-10-19T01:00:00Z',time:'21:30'});
  const saved=normalizeReminder({...freshReminder(),status:'prepared',uid,time:'21:30',preparedAt:first.createdAt});
  const reopened=createCalendarReminder({uid:saved.uid,now:saved.preparedAt,time:saved.time});
  assert.equal(reopened.content,first.content);
  assert.equal(saved.status,'prepared');
  assert.equal(saved.confirmedAt,null);
});

test('declining suppresses only today and calendar preparation is not registration confirmation',()=>{
  const fresh=freshReminder();
  assert.equal(shouldOfferReminder(fresh,'2026-10-19'),true);
  const later={...fresh,dismissedOn:'2026-10-19'};
  assert.equal(shouldOfferReminder(later,'2026-10-19'),false);
  assert.equal(shouldOfferReminder(later,'2026-10-20'),true);
  const prepared=normalizeReminder({...fresh,status:'prepared',preparedAt:'2026-10-19T01:00:00Z',uid});
  assert.equal(prepared.status,'prepared');
  assert.equal(prepared.confirmedAt,null);
  assert.equal(shouldOfferReminder(prepared,'2026-10-20'),false);
});

test('invalid local preferences and event inputs cannot inject calendar properties',()=>{
  const value=normalizeReminder({version:1,time:'25:99',status:'enabled',uid:'x\r\nATTENDEE:attacker@example.com'});
  assert.equal(value.time,'20:00');assert.equal(value.status,'none');assert.equal(value.uid,null);
  for(const time of ['24:00','8:00','00:60','20:00\nRRULE:FREQ=HOURLY'])assert.throws(()=>createCalendarReminder({uid,time}));
  assert.throws(()=>createCalendarReminder({uid:'x\r\nSUMMARY:injected'}));
  assert.throws(()=>createCalendarReminder({uid,now:'bad-date'}));
  assert.equal(reminderTimeLabel('00:00'),'오전 12:00');
  assert.equal(reminderTimeLabel('12:30'),'오후 12:30');
});
