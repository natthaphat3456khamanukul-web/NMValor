import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {getAuth,setPersistence,browserSessionPersistence,signInWithEmailAndPassword,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {getFirestore,doc,onSnapshot,runTransaction,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {firebaseConfig,ADMIN_UID} from './firebase-config.js';
import {ROUND_INFO,TEAM_STATUS,normalizeData,makeBracket,html,safeUrl} from './model.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),ref=doc(db,'settings','tournament');
const $=id=>document.getElementById(id), tf=$('teamForm'),mf=$('matchForm'),sf=$('settingsForm');
const defaults=()=>({teams:[],matches:[],links:{},announcement:{title:'เปิดรับสมัครจำนวน 16 ทีม',body:'กำหนดการแข่งขัน November 26 · วันและเวลายังไม่แน่ชัด'}});
let data=normalizeData(defaults()),revision=0,ready=false,busy=false,unsub=null,teamId='',teamRev=0,matchRev=0,settingsRev=0;
let dirty=false;
const linkNames={registration:'ฟอร์มสมัครทีม',livestream:'ถ่ายทอดสดหลัก',discord:'Discord',facebook:'Facebook',instagram:'Instagram',rulebook:'PDF กติกาฉบับล่าสุด'};
function message(text,type=''){ $('message').textContent=text;$('message').className=type; }
function fail(error){message(error.code==='permission-denied'?'ไม่มีสิทธิ์อ่านหรือบันทึกข้อมูล ตรวจ UID และ Firestore Rules':error.code?.startsWith('auth/')?'เข้าสู่ระบบไม่สำเร็จ ('+error.code+')':error.message||String(error),'error');}
function fields(){for(const id of ['teamFields','matchFields','settingsFields'])$(id).disabled=!ready||busy;for(const id of ['teamSelect','matchSelect'])$(id).disabled=!ready||busy;}
function num(v){return v===''?null:Number(v);}
for(const [container,prefix,count,required] of [['mainRoster','main',5,true],['reserveRoster','reserve',2,false]]){
 $(container).innerHTML=Array.from({length:count},(_,i)=>`<div class="grid roster-row"><label>${required?'ตัวจริง':'สำรอง'} ${i+1} · ชื่อในเกม<input name="${prefix}Ign${i}" maxlength="60" ${required?'required':''}></label><label>ตำแหน่ง<input name="${prefix}Role${i}" maxlength="40" placeholder="เช่น Jungle / Support"></label></div>`).join('');
}
$('statsFields').innerHTML=Object.entries({wins:'Win',losses:'Lose',kills:'Kills',deaths:'Deaths',assists:'Assists'}).map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0" step="1"></label>`).join('');
$('linksFields').innerHTML=Object.entries(linkNames).map(([key,label])=>`<label>${label}<input name="${key}" type="url" placeholder="https://..."></label>`).join('');
$('matchSelect').innerHTML=ROUND_INFO.flatMap(r=>Array.from({length:r.count},(_,i)=>`<option value="${r.key}-${i+1}">${r.title} · คู่ ${i+1} · BO${r.bestOf}</option>`)).join('');
function teamOptions(selected){return '<option value="">TBD / รอประกาศ</option>'+data.teams.map(t=>`<option value="${html(t.id)}" ${t.id===selected?'selected':''}>${html(t.teamName)}</option>`).join('');}
function refreshList(){const value=$('teamSelect').value;$('teamSelect').innerHTML='<option value="">+ เพิ่มทีมใหม่</option>'+data.teams.map(t=>`<option value="${html(t.id)}">${html(t.teamName)}</option>`).join('');$('teamSelect').value=value;$('teamCount').textContent=`${data.teams.length}/16`;}
function fillTeam(id=''){
 const t=data.teams.find(t=>t.id===id);teamId=t?.id||'';tf.reset();$('teamSelect').value=teamId;teamRev=revision;
 for(const key of ['id','teamName','tag','status','seed','captain'])tf.elements[key].value=t?.[key]??(key==='status'?'registered':'');
 tf.elements.id.readOnly=!!t;
 for(const key of ['wins','losses','kills','deaths','assists'])tf.elements[key].value=t?.stats[key]??'';
 for(const [prefix,list,count] of [['main',t?.mainPlayers,5],['reserve',t?.reservePlayers,2]])for(let i=0;i<count;i++){tf.elements[prefix+'Ign'+i].value=list?.[i]?.ign||'';tf.elements[prefix+'Role'+i].value=list?.[i]?.role||'';}
 dirty=false;
}
function fillMatch(){
 const match=makeBracket(data).find(m=>m.id===$('matchSelect').value);if(!match)return;
 const round=ROUND_INFO.find(r=>r.key===match.round);matchRev=revision;
 $('matchFormat').textContent=`${round.title} · BO${round.bestOf} · ชนะ ${Math.ceil(round.bestOf/2)} เกมจึงจบแมตช์`;
 for(const side of ['teamA','teamB'])mf.elements[side].innerHTML=teamOptions(match[side]);
 for(const key of ['scoreA','scoreB','status','scheduledAt','streamUrl'])mf.elements[key].value=match[key]??'';
 for(const key of ['scoreA','scoreB'])mf.elements[key].max=Math.ceil(round.bestOf/2);
 dirty=false;
}
function fillSettings(){settingsRev=revision;for(const k of Object.keys(linkNames))sf.elements[k].value=data.links[k]||'';sf.elements.announcementTitle.value=data.announcement.title;sf.elements.announcementBody.value=data.announcement.body;dirty=false;}
function mayDiscard(){return !dirty||confirm('มีข้อมูลที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขหรือไม่?');}
for(const f of [tf,mf,sf])f.addEventListener('input',()=>dirty=true);
$('teamSelect').onchange=()=>{if(mayDiscard())fillTeam($('teamSelect').value);else $('teamSelect').value=teamId;};
$('newTeam').onclick=()=>{if(mayDiscard())fillTeam();};
$('reloadMatch').onclick=()=>{if(mayDiscard())fillMatch();};
$('reloadSettings').onclick=()=>{if(mayDiscard())fillSettings();};
let selectedMatch=$('matchSelect').value;
$('matchSelect').onchange=()=>{if(mayDiscard()){selectedMatch=$('matchSelect').value;fillMatch();}else $('matchSelect').value=selectedMatch;};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{
 if(!mayDiscard())return;for(const x of document.querySelectorAll('[data-tab]'))x.setAttribute('aria-pressed',String(x===b));
 for(const pane of document.querySelectorAll('[data-pane]'))pane.hidden=pane.dataset.pane!==b.dataset.tab;
 if(b.dataset.tab==='teams')fillTeam(teamId);if(b.dataset.tab==='matches')fillMatch();if(b.dataset.tab==='settings')fillSettings();
};
async function save(base,mutate,after){
 if(busy||!ready)return;if(auth.currentUser?.uid!==ADMIN_UID){message('กรุณาล็อกอินแอดมินใหม่','error');return;}
 busy=true;fields();message('กำลังบันทึกไปยัง Firebase…');
 try{
  const result=await runTransaction(db,async tx=>{
   const snap=await tx.get(ref),raw=snap.exists()?snap.data():defaults();
   if((raw.revision||0)!==base)throw new Error('ข้อมูลบนเซิร์ฟเวอร์เปลี่ยนแล้ว กรุณาโหลดค่าล่าสุดในแท็บนี้ก่อนแก้ไขอีกครั้ง');
   const next=normalizeData(raw);mutate(next);const clean=normalizeData(next);makeBracket(clean);
   const value={...clean,revision:base+1,updatedAt:new Date().toISOString()};tx.set(ref,value);return value;
  });
  data=normalizeData(result);revision=result.revision;refreshList();dirty=false;after?.();message('บันทึกสำเร็จ — หน้าผู้ชมได้รับข้อมูลอัตโนมัติ','success');
 }catch(error){fail(error);}finally{busy=false;fields();}
}
tf.onsubmit=event=>{
 event.preventDefault();const v=Object.fromEntries(new FormData(tf)),id=v.id.trim();
 const roster=(prefix,count)=>Array.from({length:count},(_,i)=>({ign:v[prefix+'Ign'+i].trim(),role:v[prefix+'Role'+i].trim()})).filter(p=>p.ign);
 const team={id,teamName:v.teamName,tag:v.tag,status:v.status,seed:num(v.seed),captain:v.captain,mainPlayers:roster('main',5),reservePlayers:roster('reserve',2),stats:Object.fromEntries(['wins','losses','kills','deaths','assists'].map(k=>[k,num(v[k])]))};
 save(teamRev,next=>{if(!teamId&&next.teams.some(t=>t.id===id))throw new Error('รหัสทีมนี้ถูกใช้แล้ว');next.teams=next.teams.filter(t=>t.id!==teamId);next.teams.push(team);},()=>fillTeam(id));
};
$('deleteTeam').onclick=()=>{
 if(!teamId)return;const id=teamId;if(!confirm('ลบทีมนี้? หากมีแมตช์ที่อ้างถึงทีม ต้องลบแมตช์เหล่านั้นก่อน'))return;
 save(teamRev,next=>{if(next.matches.some(m=>m.teamA===id||m.teamB===id))throw new Error('ทีมนี้มีแมตช์ กรุณาลบหรือแก้คู่แข่งขันที่อ้างถึงทีมก่อน');next.teams=next.teams.filter(t=>t.id!==id);},()=>fillTeam());
};
mf.onsubmit=event=>{
 event.preventDefault();const v=Object.fromEntries(new FormData(mf)),id=$('matchSelect').value,split=id.lastIndexOf('-');
 if(v.streamUrl&&!safeUrl(v.streamUrl)){message('ลิงก์ต้องขึ้นต้นด้วย https:// หรือ http://','error');return;}
 const match={id,round:id.slice(0,split),position:Number(id.slice(split+1)),teamA:v.teamA,teamB:v.teamB,scoreA:num(v.scoreA),scoreB:num(v.scoreB),status:v.status,scheduledAt:v.scheduledAt,streamUrl:v.streamUrl};
 save(matchRev,next=>{next.matches=next.matches.filter(m=>m.id!==id);next.matches.push(match);},fillMatch);
};
$('deleteMatch').onclick=()=>{const id=$('matchSelect').value;if(confirm('ลบผลและข้อมูลคู่แข่งขันนี้? ตำแหน่งในแผนผังยังคงอยู่'))save(matchRev,next=>{next.matches=next.matches.filter(m=>m.id!==id);},fillMatch);};
sf.onsubmit=event=>{
 event.preventDefault();const v=Object.fromEntries(new FormData(sf));
 for(const k of Object.keys(linkNames))if(v[k]&&!safeUrl(v[k])){message('ลิงก์ '+linkNames[k]+' ต้องขึ้นต้นด้วย https:// หรือ http://','error');return;}
 save(settingsRev,next=>{next.links=Object.fromEntries(Object.keys(linkNames).map(k=>[k,v[k]]));next.announcement={title:v.announcementTitle,body:v.announcementBody};},fillSettings);
};
$('loginForm').onsubmit=async event=>{
 event.preventDefault();const f=event.currentTarget,button=f.querySelector('button');button.disabled=true;message('กำลังตรวจบัญชี…');
 try{await setPersistence(auth,browserSessionPersistence);await signInWithEmailAndPassword(auth,f.elements.email.value.trim(),f.elements.password.value);f.elements.password.value='';}catch(error){fail(error);}finally{button.disabled=false;}
};
$('logout').onclick=async()=>{if(mayDiscard())try{await signOut(auth);dirty=false;}catch(error){fail(error);}};
onAuthStateChanged(auth,async user=>{
 unsub?.();unsub=null;ready=false;fields();$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('identity').textContent='สำหรับผู้จัดการแข่งขัน';
 if(!user){message('กรุณาเข้าสู่ระบบ');return;}
 if(user.uid!==ADMIN_UID){await signOut(auth);message('บัญชีนี้ไม่มีสิทธิ์แอดมิน','error');return;}
 $('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('identity').textContent=user.email||'Admin';message('ล็อกอินแล้ว กำลังตรวจการอ่านข้อมูล…');
 let first=true;
 unsub=onSnapshot(ref,{includeMetadataChanges:true},snap=>{
  try{
   const raw=snap.exists()?snap.data():defaults(),next=normalizeData(raw);makeBracket(next);data=next;revision=raw.revision||0;
   ready=!snap.metadata.fromCache;fields();refreshList();
   $('connection').textContent=ready?'เชื่อมต่อ Firestore แล้ว · เวอร์ชัน '+revision:'ยังไม่ได้ยืนยันข้อมูลกับเซิร์ฟเวอร์';
   if(first&&ready){fillTeam();fillMatch();fillSettings();first=false;message('พร้อมจัดการข้อมูลการแข่งขัน','success');}
  }catch(error){ready=false;fields();fail(error);}
 },error=>{ready=false;fields();fail(error);});
 try{await setDoc(doc(db,'adminMeta','status'),{lastLoginAt:serverTimestamp(),lastLoginUID:user.uid,lastLoginEmail:user.email||''},{merge:true});}catch(error){fail(error);}
});
$('loginForm').querySelector('button').disabled=false;
window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
window.addEventListener('offline',()=>{ready=false;fields();message('ออฟไลน์ — ยังบันทึกขึ้นเว็บไม่ได้','error');});
