'use strict';

/* Public view: reads published tournament data from Firebase. No admin writes. */

const ROUND_INFO = [
  {key:'r16', title:'Round of 16', count:8, bestOf:1},
  {key:'r8', title:'Round of 8', count:4, bestOf:3},
  {key:'semifinal', title:'Semifinals', count:2, bestOf:3},
  {key:'final', title:'Grand Final', count:1, bestOf:7},
  {key:'third', title:'Third Place', count:1, bestOf:3}
];
const TEAM_STATUS = {registered:'เข้าร่วมรายการ', confirmed:'ยืนยันเข้าร่วมแล้ว', playing:'อยู่ระหว่างแข่งขัน', eliminated:'สิ้นสุดการแข่งขัน', champion:'แชมป์'};
const MATCH_STATUS = {scheduled:'รอแข่งขัน', live:'กำลังแข่งขัน', completed:'จบการแข่งขัน'};
const normalizeSearch = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('th').replace(/\s+/g,'').trim();
const cleanText = (value, max=100) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const countValue = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeUrl = value => {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const teamHash = id => '#team?id=' + encodeURIComponent(id);
const displayCount = value => value === null || value === undefined ? '—' : value.toLocaleString('th-TH');

function publicRoster(value, limit) {
  if (!Array.isArray(value)) return [];
  if (value.length > limit) throw new Error('ผู้เล่นตัวจริงได้ไม่เกิน 5 คน และสำรองได้ไม่เกิน 2 คนต่อทีม');
  return value.map(player => ({ign:cleanText(typeof player === 'string' ? player : player?.ign,60), role:cleanText(player?.role,40)})).filter(player => player.ign);
}

function normalizeData(input) {
  const source = Array.isArray(input) ? {teams:input} : input;
  if (!source || !Array.isArray(source.teams)) throw new Error('ข้อมูลต้องเป็น JSON ที่มี teams เป็นรายการทีม');
  const published = source.teams.filter(team => team && team.public !== false && team.published !== false);
  if (published.length > 16) throw new Error('รายการนี้รองรับทีมที่เผยแพร่ได้ไม่เกิน 16 ทีม');
  const ids = new Set(), names = new Set(), seeds = new Set();
  const teams = published.map(raw => {
    const teamName = cleanText(raw.teamName);
    if (!teamName) throw new Error('ทุกทีมต้องมี teamName');
    const id = cleanText(raw.id,120) || 'team-' + normalizeSearch(teamName);
    if (ids.has(id) || names.has(normalizeSearch(teamName))) throw new Error('มีชื่อทีมหรือรหัสทีมซ้ำ กรุณาตรวจสอบข้อมูล');
    ids.add(id); names.add(normalizeSearch(teamName));
    const seed = countValue(raw.seed);
    if (seed !== null && (seed < 1 || seed > 16 || seeds.has(seed))) throw new Error('หมายเลขสายแข่งขัน seed ต้องเป็น 1–16 และไม่ซ้ำกัน');
    if (seed !== null) seeds.add(seed);
    const stats = {};
    for (const key of ['wins','losses','kills','deaths','assists']) stats[key] = countValue(raw.stats?.[key]);
    return {id, teamName, tag:cleanText(raw.tag,20), seed, status:Object.hasOwn(TEAM_STATUS,raw.status) ? raw.status : 'registered',
      captain:cleanText(raw.captain,60), mainPlayers:publicRoster(raw.mainPlayers,5), reservePlayers:publicRoster(raw.reservePlayers,2), stats};
  });
  if (source.matches !== undefined && !Array.isArray(source.matches)) throw new Error('matches ต้องเป็นรายการแข่งขัน');
  const positions = new Set();
  const matches = (source.matches || []).map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('ข้อมูลแมตช์ไม่ถูกต้อง');
    const round = ROUND_INFO.find(item => item.key === raw.round);
    if (!round || !Number.isInteger(raw.position) || raw.position < 1 || raw.position > round.count) throw new Error('ตรวจสอบ round และ position ของแมตช์');
    const id = round.key + '-' + raw.position;
    if (positions.has(id)) throw new Error('มีแมตช์ซ้ำในตำแหน่งเดียวกัน');
    positions.add(id);
    const teamA = cleanText(raw.teamA,120) || null, teamB = cleanText(raw.teamB,120) || null;
    if ((teamA && !ids.has(teamA)) || (teamB && !ids.has(teamB)) || (teamA && teamA === teamB)) throw new Error('รหัสทีมในแมตช์ต้องมีใน teams และสองฝั่งต้องเป็นคนละทีม');
    const scoreA = countValue(raw.scoreA), scoreB = countValue(raw.scoreB);
    const status = Object.hasOwn(MATCH_STATUS,raw.status) ? raw.status : 'scheduled';
    const needed = Math.ceil(round.bestOf / 2);
    if ((scoreA !== null && scoreA > needed) || (scoreB !== null && scoreB > needed)) throw new Error('คะแนนเกินจำนวนเกมของรอบแข่งขัน');
    if (status === 'completed' && (!teamA || !teamB || scoreA === null || scoreB === null || Math.max(scoreA,scoreB) !== needed || scoreA === scoreB)) throw new Error('แมตช์ที่จบแล้วต้องมีทั้งสองทีมและคะแนนชนะครบตาม BO');
    return {id, round:round.key, position:raw.position, teamA, teamB, scoreA, scoreB, status, scheduledAt:cleanText(raw.scheduledAt,120), streamUrl:safeUrl(raw.streamUrl)};
  });
  const links = {};
  for (const key of ['registration','discord','facebook','instagram','livestream','rulebook']) links[key] = safeUrl(source.links?.[key]);
  return {announcement:{title:cleanText(source.announcement?.title,160),body:cleanText(source.announcement?.body,1200)}, version:1, updatedAt:cleanText(source.updatedAt,80), links, teams, matches};
}

function makeBracket(data) {
  const result = [];
  const published = new Map(data.matches.map(match => [match.id,match]));
  const seeded = new Map(data.teams.filter(team => team.seed !== null).map(team => [team.seed,team.id]));
  const winner = match => match?.status === 'completed' ? (match.scoreA > match.scoreB ? match.teamA : match.teamB) : null;
  const loser = match => match?.status === 'completed' ? (match.scoreA > match.scoreB ? match.teamB : match.teamA) : null;
  for (let r=0; r<ROUND_INFO.length; r++) {
    const round = ROUND_INFO[r];
    for (let position=1; position<=round.count; position++) {
      const id = round.key + '-' + position;
      const saved = published.get(id);
      let teamA = null, teamB = null;
      if (r === 0) { teamA = seeded.get(position*2-1) || null; teamB = seeded.get(position*2) || null; }
      else {
        const previous = round.key === 'third' ? 'semifinal' : ROUND_INFO[r-1].key;
        const advance = round.key === 'third' ? loser : winner;
        teamA = advance(result.find(match => match.id === previous + '-' + (position*2-1)));
        teamB = advance(result.find(match => match.id === previous + '-' + (position*2)));
      }
      if (saved && ((teamA && saved.teamA && teamA !== saved.teamA) || (teamB && saved.teamB && teamB !== saved.teamB))) throw new Error('ทีมในแมตช์ ' + id + ' ไม่ตรงกับสายหรือผลรอบก่อนหน้า');
      result.push({id, round:round.key, position, scoreA:null, scoreB:null, status:'scheduled', scheduledAt:'', streamUrl:'', ...saved, teamA:saved?.teamA || teamA, teamB:saved?.teamB || teamB});
    }
  }
  return result;
}

function teamStats(team,data) {
  const completed = data.matches.filter(match => match.status === 'completed' && (match.teamA === team.id || match.teamB === team.id));
  const wins = completed.filter(match => (match.scoreA > match.scoreB ? match.teamA : match.teamB) === team.id).length;
  return {...team.stats, wins:team.stats.wins ?? (completed.length ? wins : null), losses:team.stats.losses ?? (completed.length ? completed.length-wins : null)};
}
function findTeams(teams, query) {
  const q = normalizeSearch(query);
  return teams.filter(team => !q || normalizeSearch(team.teamName).includes(q) || normalizeSearch(team.tag).includes(q));
}

// Import only the public data block. Imported HTML is never inserted or executed.
function parseImportedData(text) {
  const source = String(text).trim().replace(/^\uFEFF/, '');
  if (!source.startsWith('<')) return JSON.parse(source);
  const scripts = source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const match of scripts) {
    if (/\bid\s*=\s*(?:"tournamentData"|'tournamentData'|tournamentData(?=\s|$))/.test(match[1])) {
      return JSON.parse(match[2]);
    }
  }
  throw new Error('ไม่พบข้อมูล tournamentData ในไฟล์ HTML กรุณาเลือก index.html เวอร์ชันที่มีข้อมูลทีมของคุณ');
}

/* ---------------- UI ---------------- */
const $ = id => document.getElementById(id);
let tournament = {version:1, updatedAt:'', links:{}, teams:[], matches:[]};
let bracket = [];
let dataError = '';
try { const parsed = normalizeData({teams:[],matches:[],links:{}}); const parsedBracket = makeBracket(parsed); tournament = parsed; bracket = parsedBracket; }
catch (error) { dataError = error.message; }
const menuPanel = $('menuPanel');
const menuToggle = $('menuToggle');
const noticeDialog = $('noticeDialog');

function notice(message) {
  $('noticeMessage').textContent = message;
  if (!noticeDialog.open) noticeDialog.showModal();
}
$('noticeClose').addEventListener('click',() => noticeDialog.close());
function closeMenu() { menuPanel.classList.remove('open'); menuToggle.setAttribute('aria-expanded','false'); }
menuToggle.addEventListener('click',() => {
  const open = menuPanel.classList.toggle('open'); menuToggle.setAttribute('aria-expanded',String(open));
});
document.addEventListener('click',event => { if (!menuPanel.contains(event.target) && !menuToggle.contains(event.target)) closeMenu(); });
document.addEventListener('keydown',event => { if (event.key === 'Escape') { const open = menuPanel.classList.contains('open'); closeMenu(); if(open) menuToggle.focus(); } });

function currentRoute() {
  const [raw='home', query=''] = location.hash.slice(1).split('?');
  const alias = {myteam:'teams',signin:'teams',signup:'teams'};
  const page = alias[raw] || raw || 'home';
  return {page:['home','register','bracket','leaderboard','rules','teams','team'].includes(page) ? page : 'home',params:new URLSearchParams(query)};
}
function route(focus=true) {
  const {page,params} = currentRoute();
  document.querySelectorAll('.page').forEach(element => element.classList.toggle('active',element.id === 'page-' + page));
  document.querySelectorAll('#menuPanel [data-nav], .desktop-nav [data-nav], .header-team-link').forEach(link => {
    const active = link.dataset.nav === (page === 'team' ? 'teams' : page);
    link.classList.toggle('active',active);
    if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
  closeMenu();
  const title = {home:'Magnet Of Valor',register:'Team Register',teams:'ค้นหาทีม',team:'ข้อมูลทีม',bracket:'Playoff',leaderboard:'Leader Board',rules:'Rulebook'}[page];
  document.title = title + ' | NM Arena Of Valor';
  if (page === 'teams') { if (params.has('q')) $('publicTeamSearch').value = params.get('q'); renderTeams(); }
  if (page === 'team') renderTeam(params.get('id'));
  if (page === 'bracket') renderBracket();
  if (page === 'leaderboard') renderLeaderboard();
  if (focus) {
    window.scrollTo({top:0,behavior:'instant'});
    const target = page === 'teams' ? $('publicTeamSearch') : document.querySelector('#page-' + page + ' h1, #page-' + page + ' h2');
    if (target) { if (target.tagName !== 'INPUT') target.setAttribute('tabindex','-1'); target.focus({preventScroll:true}); }
  }
}
window.addEventListener('hashchange',() => route());
document.addEventListener('click',event => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (location.hash === '#' + nav.dataset.nav) route(); else location.hash = nav.dataset.nav;
  }
  const external = event.target.closest('[data-external]');
  if (external && !external.getAttribute('href')) {
    event.preventDefault(); notice('ผู้จัดยังไม่ได้ประกาศลิงก์ ' + external.dataset.label + ' กรุณาติดตามประกาศจากผู้จัด');
  }
});
function configureLinks() {
  document.querySelectorAll('[data-external]').forEach(link => {
    const url = tournament.links[link.dataset.external];
    if (url) { link.href = url; link.setAttribute('target','_blank'); link.setAttribute('rel','noopener noreferrer'); link.removeAttribute('role'); link.removeAttribute('tabindex'); }
    else { link.removeAttribute('href'); link.removeAttribute('target'); link.setAttribute('role','button'); link.setAttribute('tabindex','0'); }
  });
}
document.querySelectorAll('[data-external]').forEach(link => link.addEventListener('keydown',event => {
  if (!link.hasAttribute('href') && ['Enter',' '].includes(event.key)) { event.preventDefault(); link.click(); }
}));
function dataNote() {
  if (dataError) return 'ไม่สามารถอ่านข้อมูลทีมได้: ' + html(dataError);
  return 'ยังไม่มีรายชื่อทีมที่ผู้จัดเผยแพร่';
}
function renderTeams() {
  const query = $('publicTeamSearch').value;
  const matches = findTeams(tournament.teams,query).sort((a,b) => a.teamName.localeCompare(b.teamName,'th'));
  $('teamResultCount').textContent = query.trim() ? 'พบ ' + matches.length + ' ทีม จาก ' + tournament.teams.length + ' ทีม' : 'เผยแพร่แล้ว ' + tournament.teams.length + ' / 16 ทีม';
  $('clearTeamSearch').hidden = !query;
  $('teamResults').innerHTML = !matches.length
    ? '<div class="empty-state team-empty">' + (tournament.teams.length ? 'ไม่พบทีมที่ค้นหา ลองตรวจชื่อหรือค้นหาเพียงบางส่วน' : dataNote()) + '</div>'
    : matches.map(team => `<a class="team-card" href="${html(teamHash(team.id))}" aria-label="ดูข้อมูลทีม ${html(team.teamName)}"><div class="team-monogram" aria-hidden="true">${html(Array.from(team.tag || team.teamName).slice(0,2).join(''))}</div><div class="team-card-copy"><h3>${html(team.teamName)}</h3><p>${html(team.tag ? team.tag + ' · ' : '')}${team.mainPlayers.length} ตัวจริง · ${team.reservePlayers.length} สำรอง</p><span class="team-status">${TEAM_STATUS[team.status]}</span></div><span class="team-arrow" aria-hidden="true">→</span></a>`).join('');
}
function rememberSearch() {
  const query = $('publicTeamSearch').value;
  const hash = '#teams' + (query ? '?q=' + encodeURIComponent(query) : '');
  try { history.replaceState(null,'',hash); } catch { /* file viewers may restrict history */ }
}
$('publicTeamSearch').addEventListener('input',() => { renderTeams(); rememberSearch(); });
$('teamSearchForm').addEventListener('submit',event => { event.preventDefault(); renderTeams(); rememberSearch(); document.querySelector('#teamResults .team-card')?.focus(); });
$('clearTeamSearch').addEventListener('click',() => { $('publicTeamSearch').value=''; renderTeams(); rememberSearch(); $('publicTeamSearch').focus(); });

function rosterMarkup(players, reserve=false) {
  return players.length ? players.map((player,index) => `<div class="row2"><span>${reserve ? 'สำรอง' : 'Player'} ${index+1}</span><b>${html(player.ign)}${player.role ? '<small>' + html(player.role) + '</small>' : ''}</b></div>`).join('') : '<p class="subtext">ยังไม่ประกาศรายชื่อผู้เล่น' + (reserve ? 'สำรอง' : 'ตัวจริง') + '</p>';
}
function teamLink(id) {
  const team = tournament.teams.find(item => item.id === id);
  return team ? `<a class="team-text-link" href="${html(teamHash(team.id))}">${html(team.teamName)}</a>` : '<span class="muted">TBD</span>';
}
function renderTeam(id) {
  const team = tournament.teams.find(item => item.id === id);
  if (!team) { $('teamDetailWrap').innerHTML='<div class="empty-state">ไม่พบทีมนี้ หรือผู้จัดยังไม่ได้เผยแพร่ข้อมูล</div>'; $('teamDetailTitle').textContent='ข้อมูลทีม'; return; }
  const stats = teamStats(team,tournament);
  const matches = bracket.filter(match => match.teamA === id || match.teamB === id);
  $('teamDetailTitle').textContent = team.teamName;
  document.title = team.teamName + ' | Magnet Of Valor';
  const statsMarkup = [['wins','Win'],['losses','Lose'],['kills','K'],['deaths','D'],['assists','A']].map(([key,label]) => `<div class="stat-cell"><span>${label}</span><b>${displayCount(stats[key])}</b></div>`).join('');
  $('teamDetailWrap').innerHTML = `<div class="myteam-card"><h3>ข้อมูลทีม</h3><div class="row2"><span>Team Name</span><b>${html(team.teamName)}</b></div>${team.tag ? '<div class="row2"><span>ตัวย่อทีม</span><b>' + html(team.tag) + '</b></div>' : ''}<div class="row2"><span>สถานะ</span><b>${TEAM_STATUS[team.status]}</b></div><div class="row2"><span>รายการ</span><b>Magnet Of Valor · 5v5</b></div><div class="row2"><span>หมายเลขในสายแข่งขัน</span><b>${team.seed ?? 'ยังไม่ประกาศ'}</b></div></div><div class="myteam-card"><h3>สถิติการแข่งขัน</h3><div class="team-stats">${statsMarkup}</div><p class="subtext stats-note">— หมายถึงยังไม่มีสถิติที่ประกาศ</p></div><div class="myteam-card"><h3>กัปตันทีม</h3><p>${html(team.captain || 'ยังไม่ประกาศ')}</p></div><div class="myteam-card"><h3>ผู้เล่นตัวจริง</h3>${rosterMarkup(team.mainPlayers)}</div><div class="myteam-card"><h3>ผู้เล่นสำรอง</h3>${rosterMarkup(team.reservePlayers,true)}</div><div class="myteam-card"><h3>แมตช์ของทีม</h3>${matches.length ? matches.map(match => `<div class="team-match"><div class="match-meta">${ROUND_INFO.find(round => round.key === match.round).title} · ${MATCH_STATUS[match.status]}</div><div class="match-teams">${teamLink(match.teamA)}<b>${displayCount(match.scoreA)} : ${displayCount(match.scoreB)}</b>${teamLink(match.teamB)}</div><p class="subtext">${html(match.scheduledAt || 'รอประกาศวันและเวลา')}${match.streamUrl ? ' · <a href="' + html(match.streamUrl) + '" target="_blank" rel="noopener noreferrer">ชมถ่ายทอดสด ↗</a>' : ''}</p></div>`).join('') : '<p class="subtext">ยังไม่ประกาศการจับคู่แข่งขัน</p>'}</div>`;
}
$('backToTeams').addEventListener('click',() => { const query=$('publicTeamSearch').value; location.hash='teams'+(query?'?q='+encodeURIComponent(query):''); });

function slotMarkup(id,score,won) {
  const team = tournament.teams.find(item => item.id === id);
  const content = `<span>${team ? html(team.teamName) : 'TBD'}</span><b>${displayCount(score)}</b>`;
  return team ? `<a class="slot${won?' winner':''}" data-team="${html(team.teamName)}" href="${html(teamHash(id))}">${content}</a>` : `<div class="slot muted">${content}</div>`;
}
function matchMarkup(match) {
  return `<div class="match-info">${html(match.id.toUpperCase())} · BO${ROUND_INFO.find(round => round.key === match.round).bestOf}${match.status === 'live' ? ' · LIVE' : ''}</div>${slotMarkup(match.teamA,match.scoreA,match.status==='completed'&&match.scoreA>match.scoreB)}${slotMarkup(match.teamB,match.scoreB,match.status==='completed'&&match.scoreB>match.scoreA)}`;
}
function renderBracket() {
  $('bracketColumns').innerHTML=ROUND_INFO.filter(round => round.key !== 'third').map(round => `<div class="bracket-col"><div class="col-title">${round.title}<span class="round-format">BO${round.bestOf}</span></div><div class="round-matches" style="--match-count:${round.count};--pitch:${1120/round.count}px">${bracket.filter(match => match.round===round.key).map(match=>`<div class="match-wrap"><div class="match">${matchMarkup(match)}</div></div>`).join('')}</div></div>`).join('');
  const third=bracket.find(match=>match.round==='third');
  $('thirdPlaceMatch').innerHTML=third?matchMarkup(third):'';
  $('bracketDataStatus').textContent=dataError || (!tournament.matches.length&&!tournament.teams.some(team=>team.seed!==null)?'ยังไม่ประกาศการจับคู่แข่งขัน · TBD = รอประกาศทีม':'กดชื่อทีมเพื่อดูข้อมูล · ทีมจะเลื่อนรอบเมื่อมีผลการแข่งขันที่ยืนยันแล้ว');
  highlightBracket();
}
function highlightBracket() {
  const query=normalizeSearch($('teamSearch').value);
  let count=0;
  document.querySelectorAll('#page-bracket [data-team]').forEach(slot=>{const match=!!query&&normalizeSearch(slot.dataset.team).includes(query);slot.classList.toggle('highlight',match);if(match)count++;});
  $('bracketSearchStatus').textContent=query?(count?'พบชื่อทีมในสาย '+count+' ตำแหน่ง':'ไม่พบทีมนี้ในสายแข่งขันที่ประกาศแล้ว'):'';
}
$('teamSearch').addEventListener('input',highlightBracket);

function renderLeaderboard() {
  if (!tournament.teams.length) { $('leaderboardWrap').innerHTML='<div class="empty-state">'+dataNote()+'</div>'; return; }
  const rows=tournament.teams.map(team=>({team,stats:teamStats(team,tournament)})).sort((a,b)=>(b.stats.wins??-1)-(a.stats.wins??-1)||(a.stats.losses??Infinity)-(b.stats.losses??Infinity)||a.team.teamName.localeCompare(b.team.teamName,'th'));
  let rank=0, previous='';
  $('leaderboardWrap').innerHTML=`<div class="table-scroll"><table class="lb-table"><caption class="sr-only">อันดับและสถิติทีมที่เผยแพร่</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Win/Lose</th><th scope="col">K</th><th scope="col">D</th><th scope="col">A</th></tr></thead><tbody>${rows.map(({team,stats},index)=>{const played=(stats.wins??0)+(stats.losses??0)>0;const score=stats.wins+':'+stats.losses;if(score!==previous)rank=index+1;previous=score;return `<tr data-rank="${played?rank:''}"><td>${played?String(rank).padStart(2,'0'):'—'}</td><td>${teamLink(team.id)}</td><td class="nowrap">${displayCount(stats.wins)}W / ${displayCount(stats.losses)}L</td><td>${displayCount(stats.kills)}</td><td>${displayCount(stats.deaths)}</td><td>${displayCount(stats.assists)}</td></tr>`;}).join('')}</tbody></table></div><p class="subtext stats-note">เรียงตามชนะมากที่สุด แล้วแพ้น้อยที่สุด · ผลเท่ากันใช้อันดับร่วม · — = ยังไม่ประกาศ${tournament.updatedAt?' · อัปเดต '+html(tournament.updatedAt):''}</p>`;
}

/* Public read-only Firebase integration. */
function downloadRulebookPdf() {
 if(tournament.links.rulebook) {window.open(tournament.links.rulebook,'_blank','noopener,noreferrer');return;}
 notice('ผู้จัดยังไม่ได้ประกาศลิงก์ PDF กรุณาอ่านกติกาในหน้า Rules');
}
['homePdfLink','rulesPdfLink'].forEach(id=>$(id).addEventListener('click',event=>{event.preventDefault();downloadRulebookPdf();}));
window.setTournamentData = (data, state) => {
 try {
  const next=normalizeData(data), nextBracket=makeBracket(next);
  tournament=next; bracket=nextBracket; dataError='';
  configureLinks();route(false);
  const heading=document.querySelector('.announce-copy h3, .announce-copy h2, .announce-copy strong');
  if(tournament.announcement.title && heading) heading.textContent=tournament.announcement.title;
  const body=document.querySelector('.announce-copy p, .announce-copy span');
  if(tournament.announcement.body && body) body.textContent=tournament.announcement.body;
  $('syncStatus').textContent=state;
 } catch(error) { $('syncStatus').textContent='ข้อมูลใหม่ไม่ถูกต้อง: '+error.message+' — แสดงข้อมูลล่าสุดที่อ่านได้'; }
};
window.setTournamentError=message=>{$('syncStatus').textContent=message;};
configureLinks();route(false);
