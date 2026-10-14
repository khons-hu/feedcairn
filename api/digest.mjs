import { configured, secureEqual, redis, HASH, sendPush, isQuiet, important, reply } from '../lib/push.mjs';
import { getFeed } from './feed.mjs';
export default async function handler(req,res) {
  if (req.method !== 'GET') return reply(res,405,{error:'Use GET.'});
  if (!configured()) return reply(res,503,{error:'Hosted notifications are not configured.'});
  if (!secureEqual(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`)) return reply(res,403,{error:'Not authorized.'});
  try {
    const day = new Date().toISOString().slice(0,10);
    if (!await redis('SET',`quiet-signal:run:${day}`,'1','NX','EX',86400)) return reply(res,200,{ok:true,skipped:true});
    const raw = await redis('HGETALL',HASH);
    const entries = Array.isArray(raw) ? Array.from({length:raw.length/2},(_,i)=>[raw[i*2],raw[i*2+1]]) : Object.entries(raw || {});
    const feeds = new Map();
    const active = [];
    for (const [id,value] of entries.slice(0,10)) {
      let record;
      try { record = JSON.parse(value); } catch { continue; }
      if (isQuiet(record.preferences)) continue;
      active.push({id,value,record});
      for (const source of record.preferences.sources) {
        if (!feeds.has(source)) feeds.set(source,getFeed(source).catch(()=>null));
      }
    }
    let sent = 0, failed = 0;
    for (const {id,value,record} of active) {
      const checkedAt = new Date().toISOString();
      const items = [];
      const fetchedAt = [];
      let complete = true;
      for (const source of record.preferences.sources) {
        const feed = await feeds.get(source);
        if (!feed) { complete = false; continue; }
        fetchedAt.push(feed.checkedAt);
        items.push(...feed.items.filter(item=>item.publishedAt && item.publishedAt > record.lastCheckedAt && item.publishedAt <= checkedAt && (record.preferences.priority === 'all' || important(item))));
      }
      // Do not advance a partial check, so a recovering source is included next time.
      if (!complete) { failed++; continue; }
      if (items.length && await redis('SET',`quiet-signal:sent:${id}:${day}`,'1','NX','EX',172800)) {
        try {
          await sendPush(record.subscription,{title:`${items.length} new signal${items.length === 1 ? '' : 's'}`,body:items.slice(0,2).map(i=>i.title).join(' · ').slice(0,250),url:process.env.APP_ORIGIN,tag:`quiet-signal-${day}`});
          sent++;
        } catch(error) { if ([404,410].includes(error.statusCode)) await redis('HDEL',HASH,id); failed++; continue; }
      }
      record.lastCheckedAt = fetchedAt.sort()[0] || record.lastCheckedAt;
      // Compare-and-set avoids reviving a removed or concurrently updated device.
      await redis('EVAL',"if redis.call('HGET',KEYS[1],ARGV[1]) == ARGV[2] then return redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]) end return 0",1,HASH,id,value,JSON.stringify(record));
    }
    return reply(res,200,{ok:true,sent,failed});
  } catch { return reply(res,502,{error:'Digest service is temporarily unavailable.'}); }
}
