// Validates the waste automatic-notes migration in isolated PGlite with synthetic records. Never connects to a remote database.
// Usage: PGLITE_MODULE_PATH=<pglite> node supabase/tests/waste-notes.mjs <waste notes migration>
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`create role anon;create role authenticated;create schema private;
create table waste_events(id uuid primary key,reported_by uuid,notes text);
insert into waste_events values('${id(1)}',null,'WhatsApp Food Waste Log (Sherwood Plaza)'),('${id(2)}',null,'Registrado via grupo Food Waste Log (Sherwood Plaza)'),('${id(3)}',null,'WhatsApp Food Waste Log (Sherwood Plaza) - Azedo'),('${id(4)}','${id(99)}','WhatsApp Food Waste Log typed by a person in the app');`);
await db.exec(fs.readFileSync(process.argv[2],'utf8'));
const notes=async n=>(await db.query(`select notes from waste_events where id='${id(n)}'`)).rows[0].notes;
assert.equal(await notes(1),null);assert.equal(await notes(2),null);assert.equal(await notes(3),'Azedo','human part kept');
assert.equal(await notes(4),'WhatsApp Food Waste Log typed by a person in the app','app users keep their notes');
await db.exec(`insert into waste_events values('${id(5)}',null,'Caiu no chão - OpenClaw automatic entry'),('${id(6)}',null,'whatsapp food waste log (natick mall)'),('${id(7)}',null,null),('${id(8)}',null,'Embalagem rasgada')`);
assert.equal(await notes(5),'Caiu no chão');assert.equal(await notes(6),null);assert.equal(await notes(7),null);assert.equal(await notes(8),'Embalagem rasgada','plain human note untouched');
await db.exec(`update waste_events set notes='Registrado via grupo Food Waste Log (Natick Mall) - Vencido' where id='${id(8)}'`);assert.equal(await notes(8),'Vencido','updates are cleaned too');
await db.exec(fs.readFileSync(process.argv[2],'utf8'));assert.equal(await notes(3),'Azedo','re-running is harmless');
await db.close();console.log('PASS waste notes: automatic annotations removed from automation records (insert, update, existing rows), human text kept, app users untouched');
