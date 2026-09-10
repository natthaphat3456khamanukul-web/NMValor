'use strict';

/* Shared public data validation and bracket calculations. */

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


export {ROUND_INFO,TEAM_STATUS,MATCH_STATUS,normalizeData,makeBracket,teamStats,findTeams,html,safeUrl};
