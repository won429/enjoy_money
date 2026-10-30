const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createEditor}=require('../admin-dues.js'),periods=require('../meeting-records.js');
const row=(amount=0)=>({name:'성원제',status:amount?'paid':'unpaid',amount});
const base=()=>({totalBalance:15000,notice:'기존 공지',records:{'10':[row(15000)]},exemptions:{'성원제':2,'전시기':1},expenses:[]});
function edit(data=base()){const editor=createEditor();editor.load(data);return{editor,data,local:structuredClone(data)};}
test('admin month reader isolates the legacy first cycle from later years',()=>{
 const data={records:{10:[row(15000)],'2026-10':[row(20000)]}};
 assert.equal(periods.rowsAt(data,2025,10)[0].amount,15000);
 assert.equal(periods.rowsAt(data,2026,10)[0].amount,20000);
 assert.deepEqual(periods.rowsAt(data,2027,10),[]);
});
test('October 2026 writes a canonical year-month key and preserves October 2025 legacy data',()=>{
 const h=edit(),r=h.editor.rows(2026,10).find(r=>r.name==='성원제');r.amount=20000;r.status='paid';
 const result=h.editor.plan(h.local,h.data);assert.equal(result.patch.records['2026-10'].find(r=>r.name==='성원제').amount,20000);
 assert.deepEqual(result.patch.records['10'],h.data.records['10']);assert.equal(periods.rowsAt(result.data,2025,10)[0].amount,15000);
 assert.equal(periods.rowsAt(result.data,2026,10).find(r=>r.name==='성원제').amount,20000);
});
test('editing legacy and padded months writes a canonical copy without mutating or deleting source keys',()=>{
 for(const [source,year,month]of[['10',2025,10],['2026-01',2026,1]]){
  const original={...base(),records:{[source]:[row(15000)]}},h=edit(original),before=JSON.stringify(original);
  h.editor.rows(year,month)[0].amount=17000;const result=h.editor.plan(h.local,original);
  assert.equal(JSON.stringify(original),before);assert.equal(result.data.records[periods.key(year,month)][0].amount,17000);
  assert.equal(result.data.records[source][0].amount,15000);
 }
});
test('simply opening months produces no writes or default unpaid data',()=>{
 const h=edit();h.editor.rows(2026,10);h.editor.rows(2027,1);assert.equal(h.editor.hasChanges(h.local),false);
 assert.deepEqual(h.editor.plan(h.local,h.data).patch,{});
});
test('one save preserves edits in several years while retaining untouched history',()=>{
 const h=edit();h.editor.rows(2025,10)[0].amount=16000;h.editor.rows(2026,10).find(r=>r.name==='성원제').amount=20000;
 const result=h.editor.plan(h.local,h.data);assert.equal(result.data.records['2025-10'][0].amount,16000);
 assert.equal(result.data.records['2026-10'].find(r=>r.name==='성원제').amount,20000);assert.deepEqual(result.data.records['10'],h.data.records['10']);
});
test('concurrent changes to other months, approvals, balances and new fields survive a targeted edit',()=>{
 const h=edit();h.editor.rows(2026,10)[0].status='deferred';
 const current=structuredClone(h.data);current.records['2027-1']=[{...row(),ticketUsed:true,ticketUsedByUid:'a',ticketRequestId:'approved'}];
 current.exemptions['전시기']=0;current.totalBalance=35000;current.serverMetadata={revision:7};
 const result=h.editor.plan(h.local,current);assert.deepEqual(result.data.records['2027-1'],current.records['2027-1']);
 assert.equal(result.data.exemptions['전시기'],0);assert.equal(result.data.totalBalance,35000);assert.deepEqual(result.data.serverMetadata,{revision:7});
});
test('a concurrent change to the edited month is rejected, including newly approved waivers',()=>{
 const h=edit();h.editor.rows(2025,10)[0].amount=18000;const current=structuredClone(h.data);
 current.records['2025-10']=[{...row(15000),ticketUsed:true,ticketRequestId:'new'}];
 assert.throws(()=>h.editor.plan(h.local,current),/2025년 10월 회비.*다른 화면/);
});
test('ticket counts merge per member and conflicting ticket, balance, notice or expense edits are rejected',()=>{
 const h=edit();h.local.exemptions['성원제']=1;const current=structuredClone(h.data);current.exemptions['전시기']=0;
 assert.deepEqual(h.editor.plan(h.local,current).data.exemptions,{'성원제':1,'전시기':0});
 current.exemptions['성원제']=0;assert.throws(()=>h.editor.plan(h.local,current),/성원제님의 면제권/);
 for(const [key,value,other]of[['totalBalance',17000,19000],['notice','내 공지','다른 공지'],['expenses',[{amount:5}],[{amount:7}]]]){
  const h=edit(),server=structuredClone(h.data);h.local[key]=value;server[key]=other;assert.throws(()=>h.editor.plan(h.local,server),/다른 화면/);
 }
});
test('records retain discount, receipt, payment and extension fields during editing',()=>{
 const data=base();data.records['2026-10']=[{...row(),duesDiscountAmount:1000,paidDate:'2026-10-01',ticketUsedAt:123,ticketUsedByUid:'a',extension:{keep:true}}];
 const h=edit(data);h.editor.rows(2026,10)[0].status='deferred';const result=h.editor.plan(h.local,data).data.records['2026-10'][0];
 assert.equal(result.duesDiscountAmount,1000);assert.equal(result.paidDate,'2026-10-01');assert.equal(result.ticketUsedByUid,'a');assert.deepEqual(result.extension,{keep:true});
});
test('staged transactions use a frozen edit even if the draft changes while awaiting server reads',()=>{
 const h=edit();h.editor.rows(2026,10)[0].amount=20000;const commit=h.editor.freeze(h.local);
 h.editor.rows(2026,10)[0].amount=90000;h.local.notice='late edit';
 const saved=commit(h.data);assert.equal(saved.data.records['2026-10'][0].amount,20000);assert.equal(saved.data.notice,h.data.notice);
});

// Execute the actual page handlers with a DOM adapter; all database operations are local mocks.
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),moduleSource=fs.readFileSync(path.join(__dirname,'../admin-dues.js'),'utf8');
function assignment(name){const start=html.indexOf('window.'+name+' = ');assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n        };',start)+12);}
function ui(data=base()){
 const nodes=new Map(),alerts=[],writes=[];let server=structuredClone(data),fail=false,account={uid:'admin'};
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:true,innerText:'',inert:false,attributes:{},classList:{contains:()=>true},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}});return nodes.get(id);}
 for(const id of ['admin-total-balance','admin-notice-input','admin-month-title','admin-dues-year','admin-screen','ledger-auto-balance'])node(id);
 const root={document:{getElementById:id=>nodes.get(id)||null},EnjoyMeetingRecords:periods,meetingData:structuredClone(data),meetingDb:{},adminDbReady:true,
  currentDuesYear:2026,currentDuesMonth:10,adminActiveTab:'dues',_savedExpenseNet:0,_ledgerAppliedDelta:0,_ledgerDirty:false,alert:m=>alerts.push(m),confirm:()=>true,
  calculateExpenseNet:rows=>rows.reduce((sum,row)=>sum+(row.type==='income'?1:-1)*row.amount,0),collectExpenses(){},buildAdminLedgerMeetings:()=>[],assignExpensesToMeetings(){}};
 root.adminDuesDb={user:()=>account,doc:(...p)=>p.join('/'),read:async()=>({exists:()=>true,data:()=>structuredClone(server)}),
  transaction:async fn=>{const pending=[];const result=await fn({get:async()=>({exists:()=>true,data:()=>structuredClone(server)}),update:(path,patch)=>pending.push({path,patch})});
   if(fail)throw Error('offline');for(const w of pending){server={...server,...structuredClone(w.patch)};writes.push(w);}return result;}};
 const context=vm.createContext({window:root,document:root.document,Date,Math,Intl,console:{error(){}},alert:root.alert,adminDateFromKey:s=>new Date(s),getKoreaDateKey:()=> '2026-10-30'});
 vm.runInContext(moduleSource,context);root.adminDues.load(data);
 root.openAdminModalReal=()=>{root.adminDues.renderPeriod();const rows=root.adminDuesRecords();rows.forEach((row,i)=>node('edit-amt-'+i).value=String(row.amount));node('admin-total-balance').value=String(root.meetingData.totalBalance);node('admin-notice-input').value=root.meetingData.notice||'';};
 for(const name of ['togglePay','toggleDeferred','toggleStopped','toggleExemptionUse','saveAdminData'])vm.runInContext(assignment(name),context);
 root.renderAdminTickets=()=>{};root.openAdminModalReal();
 const snapshotStart=html.indexOf('if (docSnap.exists()) {',html.indexOf('const subscribeMeeting ='));
 const snapshotEnd=html.indexOf('\n                }, (error)',snapshotStart);
 vm.runInContext('let isFirstLoad = true; window.applyMeetingSnapshot = (docSnap) => {'+html.slice(snapshotStart,snapshotEnd)+'};',context);
 return{root,node,alerts,writes,server:()=>server,setServer:data=>{server=structuredClone(data);},fail:()=>{fail=true;},logout:()=>{account=null;},snapshot:data=>root.applyMeetingSnapshot({exists:()=>true,data:()=>structuredClone(data)})};
}
test('real month/year controls cross December and January and clamp the first supported month',()=>{
 const h=ui();h.root.currentDuesYear=2025;h.root.currentDuesMonth=12;h.root.changeAdminMonth(1);
 assert.equal(h.root.currentDuesYear,2026);assert.equal(h.root.currentDuesMonth,1);
 h.root.changeAdminMonth(-1);assert.equal(h.root.currentDuesYear,2025);assert.equal(h.root.currentDuesMonth,12);
 h.root.currentDuesMonth=1;h.root.changeAdminYear(2025);assert.equal(h.root.currentDuesMonth,10);
});
test('real admin pay/save writes October 2026 without touching October 2025',async()=>{
 const h=ui(),rows=h.root.adminDuesRecords(),i=rows.findIndex(r=>r.name==='성원제');h.root.togglePay(i);await h.root.saveAdminData();
 assert.equal(h.server().records['2026-10'].find(r=>r.name==='성원제').amount,20000);assert.equal(h.server().records['10'][0].amount,15000);
 assert.equal(h.server().totalBalance,35000);assert.equal(h.writes.length,1);assert.match(h.alerts.at(-1),/저장 완료/);
});
test('2025 defaults to 15000 won, 2026 to 20000, and switching years retains unsaved monthly edits',async()=>{
 const h=ui({...base(),records:{}});h.root.changeAdminYear(2025);let i=h.root.adminDuesRecords().findIndex(r=>r.name==='성원제');h.root.togglePay(i);
 assert.equal(h.root.adminDuesRecords()[i].amount,15000);h.root.changeAdminYear(2026);i=h.root.adminDuesRecords().findIndex(r=>r.name==='성원제');h.root.togglePay(i);await h.root.saveAdminData();
 assert.equal(h.server().records['2025-10'].find(r=>r.name==='성원제').amount,15000);assert.equal(h.server().records['2026-10'].find(r=>r.name==='성원제').amount,20000);
});
test('manual amounts are captured before navigating, and defer/stop/waiver handlers affect only the selected year',async()=>{
 const data=base();data.records['2026-10']=[row()];const h=ui(data);h.node('edit-amt-0').value='21000';h.root.changeAdminMonth(1);h.root.changeAdminMonth(-1);
 assert.equal(h.root.adminDuesRecords()[0].amount,21000);h.root.toggleDeferred(0);assert.equal(h.root.adminDuesRecords()[0].status,'deferred');
 h.root.toggleStopped(0);assert.equal(h.root.adminDuesRecords()[0].status,'stopped');h.root.toggleExemptionUse('성원제');await h.root.saveAdminData();
 assert.equal(h.server().records['2026-10'][0].ticketUsed,true);assert.equal(h.server().exemptions['성원제'],1);assert.equal(h.server().records['10'][0].status,'paid');
});
test('failed commits leave the server unchanged and unlock the UI for retry',async()=>{
 const h=ui();h.root.togglePay(h.root.adminDuesRecords().findIndex(r=>r.name==='성원제'));const before=structuredClone(h.server());h.fail();await h.root.saveAdminData();
 assert.deepEqual(h.server(),before);assert.equal(h.writes.length,0);assert.equal(h.root.adminDues.isSaving(),false);assert.equal(h.node('admin-screen').inert,false);assert.match(h.alerts.at(-1),/offline/);
});
test('invalid amounts and expired auth cannot save; concurrent current-month changes are surfaced',async()=>{
 const h=ui();h.node('edit-amt-0').value='-1';await h.root.saveAdminData();assert.equal(h.writes.length,0);assert.match(h.alerts.at(-1),/0 이상의 정수/);
 const expired=ui();expired.root.togglePay(0);expired.logout();await expired.root.saveAdminData();assert.equal(expired.writes.length,0);
 const conflict=ui();conflict.root.togglePay(0);const server=structuredClone(conflict.server());server.records['2026-10']=[row(20000)];conflict.setServer(server);
 await conflict.root.saveAdminData();assert.equal(conflict.writes.length,0);assert.match(conflict.alerts.at(-1),/다른 화면/);
});
test('editing an already-paid amount adjusts the balance exactly once, including refund/defer transitions',async()=>{
 const h=ui();h.root.changeAdminYear(2025);h.node('edit-amt-0').value='16000';h.root.adminDues.capture();h.root.adminDues.capture();
 assert.equal(h.root.meetingData.totalBalance,16000);h.root.togglePay(0);assert.equal(h.root.meetingData.totalBalance,0);await h.root.saveAdminData();
 assert.equal(h.server().totalBalance,0);assert.equal(h.server().records['2025-10'][0].amount,0);
 const other=ui();other.root.changeAdminYear(2025);other.node('edit-amt-0').value='19000';other.root.toggleDeferred(0);
 assert.equal(other.root.meetingData.totalBalance,0);assert.equal(other.root.adminDuesRecords()[0].status,'deferred');
});
test('backups include unsaved canonical month edits without mutating the original record map',()=>{
 const h=edit();h.editor.rows(2026,10)[0].amount=20000;const before=JSON.stringify(h.local),preview=h.editor.preview(h.local);
 assert.equal(preview.records['2026-10'][0].amount,20000);assert.equal(JSON.stringify(h.local),before);assert.deepEqual(preview.records['10'],h.data.records['10']);
});
test('actual snapshot callback refreshes clean controls and preserves pending dues edits',()=>{
 const h=ui();h.snapshot(base());const newer=base();newer.totalBalance=35000;newer.records['2026-10']=[row(20000)];h.snapshot(newer);
 assert.equal(h.node('edit-amt-0').value,'20000');assert.equal(h.node('admin-total-balance').value,'35000');
 h.node('edit-amt-0').value='22000';const latest=structuredClone(newer);latest.records['2026-10'][0].amount=21000;h.snapshot(latest);
 assert.equal(h.node('edit-amt-0').value,'22000');assert.equal(h.root.adminDuesRecords()[0].amount,22000);
 assert.equal(h.root.meetingData.totalBalance,37000);
});
