# Hosted daily notifications

The hosted app can deliver one daily Web Push digest per subscribed device. It needs a hosted HTTPS deployment, Upstash Redis, and a daily scheduler. Browser permission and a push-capable browser are required. This is a daily check, not real-time monitoring. Browser and operating-system delivery can be delayed.

Set these server environment variables:

- `UPSTASH_REDIS_REST_URL`: your HTTPS Upstash Redis REST endpoint ending in `.upstash.io`.
- `UPSTASH_REDIS_REST_TOKEN`: its private REST token.
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: a Web Push VAPID key pair generated with `npx web-push generate-vapid-keys`. Keep the private key private and stable.
- `VAPID_SUBJECT`: a contact URI such as `mailto:you@example.com`.
- `APP_ORIGIN`: the exact HTTPS application origin, without a trailing slash.
- `PUSH_ENROLLMENT_KEY`: a strong private enrollment password. Enter it in the app when managing notifications. Requests send it in `x-enrollment-key`, never in a URL. Do not put it in client environment variables or commit it.
- `CRON_SECRET`: a separate strong scheduler secret. The scheduler must call `GET /api/digest` with `Authorization: Bearer <CRON_SECRET>` once a day.

No credentials or deployment are included. Provider free tiers and quotas depend on the provider's current terms. Daily execution is compatible with a single daily schedule. Choose a schedule outside your configured quiet hours. A run inside quiet hours is skipped until the next scheduled day, not deferred to the end of quiet hours. Equal start and end disables quiet hours.

The API stores at most ten device subscriptions in the `quiet-signal:subscriptions` Redis hash. Stored data includes the push endpoint, encryption keys, selected sources, priority preference, timezone, quiet hours, and last successful check. Enrollment starts at the current time, so historical posts are excluded. Resubscribing or changing settings starts a new baseline. Feed items with missing dates cannot trigger a notification. Important-only filtering uses a simple title/release heuristic and can miss relevant posts or include less useful ones.

Daily locks prevent duplicate attempts on the same UTC day. A failed attempt may wait until the following day. If any selected source fails, the device's digest waits until all its sources can be checked. Feeds contain a bounded recent history, so prolonged downtime can miss older entries. Expired subscriptions returning 404 or 410 are deleted. The endpoint and keys are not returned by the API or included in API errors. Only the configured public VAPID key is exposed.

Use Disconnect & delete subscription to delete the device's server record and unsubscribe its browser push subscription. Clearing browser storage alone does not delete the server record. If that happens, remove the corresponding hash entry in your Upstash console, or delete the entire subscription hash to remove all devices. Short-lived hashed rate-limit and daily-lock keys expire automatically within two days. Do not enable request-body/header logging for enrollment or subscription calls.

The app exposes `GET /api/push` for configuration. Authenticated `POST /api/push` accepts `subscribe`, `unsubscribe`, or `test`. Subscribe requires a browser PushSubscription and preferences. Unsubscribe requires its endpoint. Tests are rate limited to once per device per minute. All mutations require either the configured origin or the published `https://relay.khns.dev` origin, plus the enrollment header. Other origins remain blocked.

Browser data and notification permission belong to each origin. Export a backup from the old address and import it at the new one to move saved links and reading state. Connect notifications separately on the new address if wanted. Keep `APP_ORIGIN` unchanged while legacy subscriptions are in use so their notification links continue to open the original app.

Vercel Marketplace Redis installs `KV_REST_API_URL` and `KV_REST_API_TOKEN`. These are accepted as aliases for the two `UPSTASH_REDIS_REST_*` variables, so you do not need to copy or expose the managed credentials.
