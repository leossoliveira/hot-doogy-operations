import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadPlan, buildSQL, executeSQL, sha256} from '../scripts/deploy-database.mjs';

test('freeze historical SQL and reject backdated or duplicate new versions', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'db-plan-'));
  try {
    mkdirSync(path.join(dir,'supabase/migrations'), {recursive:true});
    const original='select 1;',file='20261016000000_old.sql';
    writeFileSync(path.join(dir,'supabase/migrations',file),original);
    writeFileSync(path.join(dir,'supabase/deployment-baseline.json'),JSON.stringify({cutoff:'20261016000000',local:[{file,sha256:sha256(original)}],remote:[]}));
    assert.equal(loadPlan(dir).migrations.length,0);
    writeFileSync(path.join(dir,'supabase/migrations/20261015000000_old_insert.sql'),'select 2;');
    assert.throws(()=>loadPlan(dir),/follow baseline/);
    rmSync(path.join(dir,'supabase/migrations/20261015000000_old_insert.sql'));
    writeFileSync(path.join(dir,'supabase/migrations',file),'select 2;');
    assert.throws(()=>loadPlan(dir),/Frozen migration/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('release identity and rollback target are validated before generating SQL', () => {
  const plan={baseline:{remote:[{version:'20261016000000'}]},migrations:[]};
  assert.throws(()=>buildSQL(plan,{mode:'activate',version:"x';drop schema public",commit:'a'.repeat(40)}),/identity/);
  assert.throws(()=>buildSQL(plan,{mode:'rollback',version:'v0.1.1',commit:'a'.repeat(40)}),/previous/);
});

test('database client keeps credentials out of argv and blocks config readable by others', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'db-config-')),file=path.join(dir,'config.json');
  try {
    writeFileSync(file,JSON.stringify({project_id:'kfnsfnytnnpwptklmbip',host:'aws-0-us-west-2.pooler.supabase.com',user:'postgres.kfnsfnytnnpwptklmbip',pgpassfile:'/private/password',sslrootcert:'/private/ca'}),{mode:0o600});
    let called=false;
    executeSQL('SELECT 1;',file,{spawn:(command,args,options)=>{
      called=true; assert.equal(command,'/usr/bin/psql'); assert.equal(options.env.PGSSLMODE,'verify-full');
      assert.equal(options.env.PGPASSFILE,'/private/password'); assert.equal(options.input,'SELECT 1;');
      assert.ok(!args.some(a=>a.includes('password'))); return {status:0};
    }});
    assert.equal(called,true);
    chmodSync(file,0o644);
    assert.throws(()=>executeSQL('SELECT 1;',file),/0600/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
