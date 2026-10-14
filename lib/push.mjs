import {classify} from './rules.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import webPush from 'web-push';
import { sources } from './sources.mjs';
export const HASH = 'quiet-signal:subscriptions';
export const secureEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 0 && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const storageUrl = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const storageToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const configured = () => Boolean(storageUrl() && storageToken()) && ['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','CRON_SECRET','APP_ORIGIN','PUSH_ENROLLMENT_KEY'].every(k => Boolean(process.env[k]));
export const subscriptionId = endpoint => createHash('sha256').update(endpoint).digest('hex');
export function validEndpoint(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' || u.hostname === 'web.push.apple.com');
  } catch { return false; }
}
export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || !validEndpoint(value.endpoint)) throw new Error('Invalid subscription.');
  const { p256dh, auth } = value.keys || {};
  const key = (v, bytes) => typeof v === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(v) && Buffer.from(v, 'base64url').length === bytes;
  if (!key(p256dh,65) || !key(auth,16)) throw new Error('Invalid subscription keys.');
  return { endpoint: value.endpoint, keys: { p256dh, auth } };
}
export function validatePreferences(value = {}) {
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > sources.length || value.sources.some(id => !sources.some(s => s.id === id))) throw new Error('Choose valid sources.');
  const timezone = value.timezone || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('Invalid time zone.'); }
  const quietStart = value.quietStart ?? 22;
  const quietEnd = value.quietEnd ?? 8;
  if (![quietStart, quietEnd].every(n => Number.isInteger(n) && n >= 0 && n <= 23)) throw new Error('Invalid quiet hours.');
  if (value.priority !== undefined && !['all','important'].includes(value.priority)) throw new Error('Invalid priority.');
  return { sources: [...new Set(value.sources)], timezone, quietStart, quietEnd, priority: value.priority || 'important' };
}
export function isQuiet(preferences, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const { quietStart: start, quietEnd: end } = preferences;
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
export const important = item => classify(item).important;
export async function redis(...command) {
  const url = new URL(storageUrl());
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io')) throw new Error('Storage unavailable.');
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${storageToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  if (!response.ok) throw new Error('Storage unavailable.');
  const result = await response.json();
  if (result.error) throw new Error('Storage unavailable.');
  return result.result;
}
export async function sendPush(subscription, payload) {
  webPush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return webPush.sendNotification(validateSubscription(subscription), JSON.stringify(payload), { TTL: 86400, timeout: 8000 });
}
export function reply(res, code, data, cacheControl = 'no-store') { res.statusCode = code; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control',cacheControl); res.setHeader('X-Content-Type-Options','nosniff'); res.end(JSON.stringify(data)); }
export async function readBody(req) {
  const declared = Number(req.headers['content-length']);
  if (declared > 8192) throw new Error('Request too large.');
  if (req.body !== undefined) { const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body); if (Buffer.byteLength(raw) > 8192) throw new Error('Request too large.'); return typeof req.body === 'object' ? req.body : JSON.parse(raw); }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) throw new Error('Request too large.'); }
  return JSON.parse(raw);
}
