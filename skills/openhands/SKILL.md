---
name: openhands
description: Use the OpenHands Agent Server (sibling container) for sandboxed browser/desktop automation when the task requires viewing a real webpage, taking screenshots, clicking UI, or running GUI-bound tools.
loaded_by_default: false
---

# OpenHands Agent Server — Sandboxed Computer-Use

Use this skill when a task requires **operating a real browser or desktop** (e.g. inspect a hotel website screenshot, click through a booking flow, audit a competitor site visually). The Stratex swarm runs an `openhands-agent` container alongside Hermes; you call it via internal HTTP.

## Trigger
- Task says "screenshot", "browser", "click", "visit URL"
- Task references checking a real URL beyond simple fetch
- Designer needs visual reference of an existing hospitality site
- QA does visual smoke test

## Endpoint

Base URL (internal compose DNS): `http://openhands-agent:8000`

Phil sees the desktop live at `http://localhost:18002/vnc.html?autoconnect=1&resize=remote` via SSH-tunnel `-L 18002:127.0.0.1:18002`.

## Steps

### 1. Verify reachability
```
curl -fsS http://openhands-agent:8000/health
# expected: "OK"
```

### 2. Create a conversation (sandbox session)
```
curl -X POST http://openhands-agent:8000/api/conversations \
  -H "Content-Type: application/json" \
  -d "{}"
# returns: {"id": "<conversation_id>", ...}
```

Keep `conversation_id` — every action references it.

### 3. Send actions
Endpoints under `/api/conversations/{conversation_id}/...`:
- POST `/events` — submit an action event (bash command, browser action, screenshot)
- GET `/events` — paginate event stream (model responses, observations)
- POST `/run` — start/continue agent processing
- GET `/agent_final_response` — wait for completion

OpenAPI docs: `http://openhands-agent:8000/docs`

### 4. Get screenshot
The agent server exposes a screenshot endpoint that takes a PNG of the xfce4 desktop. Use it to provide visual evidence in your checkpoint.

### 5. Close conversation
```
curl -X DELETE http://openhands-agent:8000/api/conversations/{conversation_id}
```

## Pitfalls
- VNC is enabled but no authentication on the noVNC port. Workers MUST NOT expose the noVNC port externally; only Phil tunnels.
- One conversation per task — do not reuse a stale conversation across unrelated missions.
- Screenshots are large (1440x900 PNG, ~300KB). Embed only summary text in checkpoint RESULT; attach screenshot to handoff dir.
- Browser runs non-headless when VNC is enabled — visible in Phil's noVNC view. Do not navigate to sensitive sites.

## Output contract
When using OpenHands, your checkpoint must include:

```
COMMANDS_RUN: curl http://openhands-agent:8000/api/conversations ...
RESULT: <text summary of what you observed> + screenshot path
```

## Capability gating
This skill is loaded by workers whose roster capability includes `computer-use`. As of Phase 2, that is `swarm7 QA` and `swarm9 Designer`. Other workers should not invoke OpenHands directly — route via the orchestrator.
