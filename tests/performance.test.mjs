import test from 'node:test';
import assert from 'node:assert/strict';
import digest from '../api/digest.mjs';
import push from '../api/push.mjs';

const response=()=>({headers:{},setHeader(key,value){this.headers[key]=value;},end(raw){this.body=JSON.parse(raw);}});
test('public push configuration is cached, rejected mutations are not',async()=>{
  const get=response();await push({method:'GET',headers:{}},get);
  assert.equal(get.headers['Cache-Control'],'public, max-age=0, s-maxage=300');
  const post=response();await push({method:'POST',headers:{}},post);
  assert.equal(post.headers['Cache-Control'],'no-store');
});
test('digest starts independent sources together and still preserves compare-and-set',async()=>{
  const values={UPSTASH_REDIS_REST_URL:'https://test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'fixture',VAPID_PUBLIC_KEY:'fixture',VAPID_PRIVATE_KEY:'fixture',VAPID_SUBJECT:'mailto:fixture@example.com',CRON_SECRET:'fixture',APP_ORIGIN:'https://example.com',PUSH_ENROLLMENT_KEY:'fixture'};
  const saved=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  Object.assign(process.env,values);
  const original=global.fetch,commands=[],started=[];
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const record={preferences:{sources:['openai'],timezone:'UTC',quietStart:0,quietEnd:0,priority:'all'},lastCheckedAt:'2020-01-01T00:00:00Z'};
  const secondRecord={...record,preferences:{...record.preferences,sources:['deepmind','openai']}};
  global.fetch=async(url,options)=>{
    if(String(url).includes('test.upstash.io')){
      const command=JSON.parse(options.body);commands.push(command);
      return new Response(JSON.stringify({result:command[0]==='HGETALL'?['fixture-device',JSON.stringify(record),'second-device',JSON.stringify(secondRecord)]:1}));
    }
    started.push(String(url));await gate;
    return new Response('<rss><channel></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});
  };
  const res=response();let run;
  try{
    run=digest({method:'GET',headers:{authorization:'Bearer fixture'}},res);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(started.length,2,'all unique subscriber feeds must start before either resolves');
  }finally{
    release();await run;global.fetch=original;
    for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  assert.deepEqual(res.body,{ok:true,sent:0,failed:0});
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert(commands.some(command=>command[0]==='EVAL'&&command[1].includes("redis.call('HGET'")));
});
