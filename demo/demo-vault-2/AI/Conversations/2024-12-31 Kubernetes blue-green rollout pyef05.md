---
curtis: conversation
id: conv_1791393355251_b3jpyef05
created: 1735689600000
updated: 1735689720000
provider: chatgpt
model: gpt-4o
---

# Kubernetes blue-green rollout

## You
<!-- curtis:msg {"id":"msg_1791393355251_zg3kbs","ts":1735689600000,"role":"user"} -->

How do I do a blue-green rollout of my API on k8s?

## AI
<!-- curtis:msg {"id":"msg_1791393355251_wdu0sr","ts":1735689630000,"role":"assistant","model":"gpt-4o"} -->

Run two deployments and flip the Service selector once green is healthy:

```yaml
kind: Service
spec:
  selector:
    app: api
    version: green   # flip from blue to green here
```

Watch the green deployment's readiness gates before the flip, and keep blue around for instant rollback.

## You
<!-- curtis:msg {"id":"msg_1791393355251_oszf8e","ts":1735689660000,"role":"user"} -->

And the database migration?

## AI
<!-- curtis:msg {"id":"msg_1791393355251_uo7iyo","ts":1735689690000,"role":"assistant","model":"gpt-4o"} -->

Migrations go first, but only the backward-compatible kind: add columns nullable, dual-write, backfill, then drop later. Never deploy schema and code that only work together in the same minute.
