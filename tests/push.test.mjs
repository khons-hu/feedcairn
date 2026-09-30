import test from 'node:test';
import assert from 'node:assert/strict';
import { configured,validEndpoint,validateSubscription,validatePreferences,isQuiet,secureEqual,readBody } from '../lib/push.mjs';
import handler from '../api/push.mjs';
import digest from '../api/digest.mjs';
test('push endpoints are restricted to actual HTTPS push hosts',()=>{
 for(const value of ['http://fcm.googleapis.com/x','https://evil.fcm.googleapis.com/x','https://fcm.googleapis.com.evil.com/x','https://user:pass@fcm.googleapis.com/x','https://127.0.0.1/x','https://updates.push.services.mozilla.com:444/x']) assert.equal(validEndpoint(value),false,value);
 for(const host of ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']) assert.equal(validEndpoint(`https://${host}/token`),true);
});
test('subscription keys, source IDs and time zones are validated',()=>{
 assert.throws(()=>validateSubscription({endpoint:'https://fcm.googleapis.com/x',keys:{p256dh:'x',auth:'y'}}));
 assert.throws(()=>validatePreferences({sources:['unknown']}));
 assert.throws(()=>validatePreferences({sources:['openai'],timezone:'invalid'}));
 assert.throws(()=>validatePreferences({sources:['openai'],quietStart:24}));
 assert.equal(validatePreferences({sources:['openai']}).priority,'important');
});
test('quiet hours cross midnight and honor timezone',()=>{
 const prefs={timezone:'UTC',quietStart:22,quietEnd:8};
 assert.equal(isQuiet(prefs,new Date('2026-09-20T23:00:00Z')),true);
 assert.equal(isQuiet(prefs,new Date('2026-09-20T07:00:00Z')),true);
 assert.equal(isQuiet(prefs,new Date('2026-09-20T12:00:00Z')),false);
});
test('secrets compare safely and empty secrets never authorize',()=>{
 assert.equal(secureEqual('a','a'),true);assert.equal(secureEqual('',''),false);assert.equal(secureEqual('a','aa'),false);
});
test('request size is bounded even with a parsed body',async()=>{
 await assert.rejects(readBody({headers:{},body:{x:'a'.repeat(8192)}}),/large/);
});
test('mutation and cron reject unauthenticated calls before storage access',async()=>{
 const names=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','CRON_SECRET','APP_ORIGIN','PUSH_ENROLLMENT_KEY'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 names.forEach(k=>process.env[k]='test-secret'); process.env.APP_ORIGIN='https://example.com';
 const response=()=>({setHeader(){},end(raw){this.body=JSON.parse(raw);}});
 try {
  for(const headers of [{},{origin:'https://evil.com','x-enrollment-key':'test-secret'},{origin:'https://example.com','x-enrollment-key':'wrong'},{origin:'https://relay.khns.dev','x-enrollment-key':'wrong'},...['http://relay.khns.dev','https://relay.khns.dev.attacker.example','https://attacker-relay.khns.dev'].map(origin=>({origin,'x-enrollment-key':'test-secret'}))]){const res=response();await handler({method:'POST',headers},res);assert.equal(res.statusCode,403);}
  for(const origin of ['https://example.com','https://relay.khns.dev']){const res=response();await handler({method:'POST',headers:{origin,'x-enrollment-key':'test-secret'},body:{}},res);assert.equal(res.statusCode,400);assert.equal(res.body.error,'Invalid notification request. Check subscription and preferences.');}
  const res=response();await digest({method:'GET',headers:{authorization:'Bearer wrong'}},res);assert.equal(res.statusCode,403);
 } finally {for(const k of names) if(saved[k]===undefined) delete process.env[k];else process.env[k]=saved[k];}
});

test('Vercel Marketplace Redis aliases configure storage without copying credentials',()=>{
 const names=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','CRON_SECRET','APP_ORIGIN','PUSH_ENROLLMENT_KEY'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try {
  names.forEach(k=>process.env[k]='test-only');
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal(configured(),true);
  delete process.env.KV_REST_API_TOKEN; assert.equal(configured(),false);
 } finally { for(const k of names) if(saved[k]===undefined) delete process.env[k];else process.env[k]=saved[k]; }
});
