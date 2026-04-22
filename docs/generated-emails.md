# Generated Email Aliases

Generated: 2026-04-15
Domain: `zayd.wtf`
Forward to: `zaydkhan3@gmail.com`
Total: 5

## Setup

Add each alias via **Cloudflare Dashboard → Email → Email Routing → Add address**.
Free tier: up to 200 routes per domain. No MX changes needed if domain is already on Cloudflare.

## One-per-line (paste into BulkAuthWizard)

```
ember3160@zayd.wtf
rift7506@zayd.wtf
vector5953@zayd.wtf
invoke6344@zayd.wtf
helix2472@zayd.wtf
```

## Table

| # | Address | Forwards To | Status |
|---|---------|-------------|--------|
|  1 | `ember3160@zayd.wtf` | zaydkhan3@gmail.com | pending |
|  2 | `rift7506@zayd.wtf` | zaydkhan3@gmail.com | pending |
|  3 | `vector5953@zayd.wtf` | zaydkhan3@gmail.com | pending |
|  4 | `invoke6344@zayd.wtf` | zaydkhan3@gmail.com | pending |
|  5 | `helix2472@zayd.wtf` | zaydkhan3@gmail.com | pending |

## Cloudflare bulk-add (API)

```bash
# CF_API_TOKEN=your_token
# CF_ZONE_ID=your_zayd.wtf_zone_id

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  -d '{"matchers":[{"type":"literal","field":"to","value":"ember3160@zayd.wtf"}],"actions":[{"type":"forward","value":["zaydkhan3@gmail.com"]}],"enabled":true}'

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  -d '{"matchers":[{"type":"literal","field":"to","value":"rift7506@zayd.wtf"}],"actions":[{"type":"forward","value":["zaydkhan3@gmail.com"]}],"enabled":true}'

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  -d '{"matchers":[{"type":"literal","field":"to","value":"vector5953@zayd.wtf"}],"actions":[{"type":"forward","value":["zaydkhan3@gmail.com"]}],"enabled":true}'

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  -d '{"matchers":[{"type":"literal","field":"to","value":"invoke6344@zayd.wtf"}],"actions":[{"type":"forward","value":["zaydkhan3@gmail.com"]}],"enabled":true}'

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  -d '{"matchers":[{"type":"literal","field":"to","value":"helix2472@zayd.wtf"}],"actions":[{"type":"forward","value":["zaydkhan3@gmail.com"]}],"enabled":true}'
```
