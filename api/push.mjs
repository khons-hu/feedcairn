import { configured, secureEqual, validateSubscription, validatePreferences, validEndpoint, subscriptionId, redis, HASH, sendPush, readBody, reply } from '../lib/push.mjs';
export default async function handler(req,res) {
  if (req.method === 'GET') return reply(res,200,{configured:configured(),publicKey:configured()?process.env.VAPID_PUBLIC_KEY:null});
  if (req.method !== 'POST') return reply(res,405,{error:'Use GET or POST.'});
  if (!configured()) return reply(res,503,{error:'Hosted notifications are not configured.'});
  const trustedOrigin = [process.env.APP_ORIGIN,'https://relay.khns.dev'].some(origin => secureEqual(req.headers.origin,origin));
  if (!trustedOrigin || !secureEqual(req.headers['x-enrollment-key'],process.env.PUSH_ENROLLMENT_KEY)) return reply(res,403,{error:'Not authorized.'});
  let body, subscription, preferences;
  try {
    body = await readBody(req);
    if (!['subscribe','unsubscribe','test'].includes(body.action)) throw new Error('Invalid action.');
    if (body.action === 'unsubscribe') { if (!validEndpoint(body.endpoint)) throw new Error('Invalid subscription.'); }
    else { subscription = validateSubscription(body.subscription); if (body.action === 'subscribe') preferences = validatePreferences(body.preferences); }
  } catch { return reply(res,400,{error:'Invalid notification request. Check subscription and preferences.'}); }
  try {
    const id = subscriptionId(body.endpoint || subscription.endpoint);
    if (body.action === 'unsubscribe') await redis('HDEL',HASH,id);
    if (body.action === 'subscribe') {
      const record = JSON.stringify({subscription,preferences,lastCheckedAt:new Date().toISOString()});
      const saved = await redis('EVAL',"if redis.call('HEXISTS',KEYS[1],ARGV[1]) == 0 and redis.call('HLEN',KEYS[1]) >= 10 then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]); return 1",1,HASH,id,record);
      if (!saved) return reply(res,409,{error:'The ten-device limit has been reached.'});
    }
    if (body.action === 'test') {
      const allowed = await redis('SET',`quiet-signal:test:${id}`,'1','NX','EX',60);
      if (!allowed) return reply(res,429,{error:'Please wait one minute before testing again.'});
      await sendPush(subscription,{title:'Khonrelay is connected',body:'This device can receive your daily digest.',url:process.env.APP_ORIGIN,tag:'quiet-signal-test'});
    }
    return reply(res,200,{ok:true});
  } catch { return reply(res,502,{error:'Notification service is temporarily unavailable.'}); }
}
