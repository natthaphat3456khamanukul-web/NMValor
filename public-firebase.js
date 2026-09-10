// This module only reads public data; it never authenticates viewers or writes.
try {
 const [{firebaseConfig},{initializeApp},{getFirestore,doc,onSnapshot}]=await Promise.all([
  import('./firebase-config.js'),import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js')]);
 const db=getFirestore(initializeApp(firebaseConfig));
 onSnapshot(doc(db,'settings','tournament'),{includeMetadataChanges:true},snapshot=>{
  window.setTournamentData(snapshot.exists()?snapshot.data():{teams:[],matches:[],links:{}},snapshot.metadata.fromCache?'กำลังยืนยันข้อมูลกับเซิร์ฟเวอร์ — ข้อมูลอาจยังไม่ล่าสุด':snapshot.exists()?'เชื่อมต่อแล้ว · ข้อมูลอัปเดตจากผู้จัด':'เชื่อมต่อแล้ว · ผู้จัดยังไม่เผยแพร่ข้อมูล');
 },error=>window.setTournamentError('อ่านข้อมูลไม่ได้ ('+error.code+') กรุณาลองโหลดหน้าใหม่'));
} catch {window.setTournamentError('เชื่อมต่อ Firebase ไม่ได้ กรุณาตรวจอินเทอร์เน็ต แล้วโหลดหน้าใหม่');}
window.addEventListener('offline',()=>window.setTournamentError('ออฟไลน์ — แสดงข้อมูลที่โหลดไว้ล่าสุด'));
