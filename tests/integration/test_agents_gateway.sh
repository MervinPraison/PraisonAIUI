#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Integration Test: Agents CRUD ↔ Gateway
# Validates every feature with real agent responses
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:8082"
PASS=0
FAIL=0
TESTS=()

pass() { PASS=$((PASS+1)); TESTS+=("✅ $1"); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); TESTS+=("❌ $1: $2"); echo "  ❌ $1: $2"; }

echo "═══════════════════════════════════════════════════════════"
echo " Agents CRUD ↔ Gateway Integration Tests"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. CREATE ────────────────────────────────────────────────────────
echo "── Test 1: Create Agent via CRUD ──"
CREATE=$(curl -sf -X POST "$BASE/api/agents/definitions" \
  -H "Content-Type: application/json" \
  -d '{"name":"IntegrationTestAgent","instructions":"You MUST start every response with INTEGRATION-OK: then answer the question.","model":"gpt-4o-mini"}')
AGENT_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
AGENT_NAME=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")

if [ "$AGENT_NAME" = "IntegrationTestAgent" ]; then
  pass "Create returns correct name"
else
  fail "Create returns correct name" "got $AGENT_NAME"
fi
echo "     Agent ID: $AGENT_ID"

# ── 2. GET (CRUD agent) ─────────────────────────────────────────────
echo ""
echo "── Test 2: Get Agent by ID (CRUD) ──"
GET_NAME=$(curl -sf "$BASE/api/agents/definitions/$AGENT_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
if [ "$GET_NAME" = "IntegrationTestAgent" ]; then
  pass "GET /definitions/{id} returns CRUD agent"
else
  fail "GET /definitions/{id} returns CRUD agent" "got $GET_NAME"
fi

# ── 3. LIST includes CRUD agent ─────────────────────────────────────
echo ""
echo "── Test 3: List includes CRUD agent ──"
LIST_HAS=$(curl -sf "$BASE/api/agents/definitions" | \
  python3 -c "
import sys,json
data=json.load(sys.stdin)
names=[a['name'] for a in data['agents']]
print('YES' if 'IntegrationTestAgent' in names else 'NO')
")
if [ "$LIST_HAS" = "YES" ]; then
  pass "List includes created CRUD agent"
else
  fail "List includes created CRUD agent" "not found in list"
fi

# ── 4. LIST includes gateway-only agents ────────────────────────────
echo ""
echo "── Test 4: List merges gateway-only agents ──"
GW_COUNT=$(curl -sf "$BASE/api/agents/definitions" | \
  python3 -c "
import sys,json
data=json.load(sys.stdin)
gw=[a for a in data['agents'] if a.get('source')=='gateway']
print(len(gw))
")
if [ "$GW_COUNT" -gt "0" ]; then
  pass "List includes $GW_COUNT gateway-only agents"
else
  fail "List includes gateway-only agents" "count=$GW_COUNT"
fi

# ── 5. GET gateway-only agent (fallback) ─────────────────────────────
echo ""
echo "── Test 5: Get gateway-only agent by ID ──"
GW_AGENT_ID=$(curl -sf "$BASE/api/agents/definitions" | \
  python3 -c "
import sys,json
data=json.load(sys.stdin)
gw=[a for a in data['agents'] if a.get('source')=='gateway']
print(gw[0]['id'] if gw else '')
")
if [ -n "$GW_AGENT_ID" ]; then
  GW_GET=$(curl -sf "$BASE/api/agents/definitions/$GW_AGENT_ID" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','FAIL'))")
  if [ "$GW_GET" != "FAIL" ] && [ "$GW_GET" != "" ]; then
    pass "GET gateway agent '$GW_GET' ($GW_AGENT_ID)"
  else
    fail "GET gateway agent" "returned empty/fail"
  fi
else
  fail "GET gateway agent" "no gateway agents found"
fi

# ── 6. RUN — execute and validate agent response ────────────────────
echo ""
echo "── Test 6: Run CRUD Agent (validate instructions) ──"
RUN_RESULT=$(curl -sf -X POST "$BASE/api/agents/run/$AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is 7 times 6?"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('result','ERROR'))")
echo "     Response: ${RUN_RESULT:0:100}"
if echo "$RUN_RESULT" | grep -qi "INTEGRATION-OK"; then
  pass "Agent response starts with INTEGRATION-OK (instructions respected)"
else
  fail "Agent response starts with INTEGRATION-OK" "response: ${RUN_RESULT:0:80}"
fi

# ── 7. UPDATE — change instructions, verify new behavior ────────────
echo ""
echo "── Test 7: Update Agent instructions ──"
curl -sf -X PUT "$BASE/api/agents/definitions/$AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"instructions":"You MUST start every response with UPDATED-AGENT: then answer."}' > /dev/null

UPDATE_RESULT=$(curl -sf -X POST "$BASE/api/agents/run/$AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is 10 minus 3?"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('result','ERROR'))")
echo "     Response: ${UPDATE_RESULT:0:100}"
if echo "$UPDATE_RESULT" | grep -qi "UPDATED-AGENT"; then
  pass "Updated agent responds with UPDATED-AGENT (re-synced to gateway)"
else
  fail "Updated agent responds with UPDATED-AGENT" "response: ${UPDATE_RESULT:0:80}"
fi

# ── 8. DUPLICATE — verify copy and instructions ─────────────────────
echo ""
echo "── Test 8: Duplicate Agent ──"
DUP=$(curl -sf -X POST "$BASE/api/agents/duplicate/$AGENT_ID")
DUP_ID=$(echo "$DUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
DUP_NAME=$(echo "$DUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
DUP_INSTRUCTIONS=$(echo "$DUP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('instructions',''))")
if echo "$DUP_NAME" | grep -q "(Copy)"; then
  pass "Duplicate name has (Copy) suffix: $DUP_NAME"
else
  fail "Duplicate name has (Copy) suffix" "got $DUP_NAME"
fi
if echo "$DUP_INSTRUCTIONS" | grep -q "UPDATED-AGENT"; then
  pass "Duplicate preserved updated instructions"
else
  fail "Duplicate preserved updated instructions" "instructions: ${DUP_INSTRUCTIONS:0:50}"
fi

# ── 9. PERSISTENCE — check file on disk ─────────────────────────────
echo ""
echo "── Test 9: Persistence to disk ──"
PERSIST_CHECK=$(python3 -c "
import json
with open('$HOME/.praisonaiui/agents.json') as f:
    data = json.load(f)
agents = data.get('agents', {})
has_test = '$AGENT_ID' in agents
has_dup = '$DUP_ID' in agents
print(f'{len(agents)}|{has_test}|{has_dup}')
" 2>&1)
PERSIST_COUNT=$(echo "$PERSIST_CHECK" | cut -d'|' -f1)
HAS_ORIG=$(echo "$PERSIST_CHECK" | cut -d'|' -f2)
HAS_DUP=$(echo "$PERSIST_CHECK" | cut -d'|' -f3)
if [ "$HAS_ORIG" = "True" ]; then
  pass "Original agent persisted to disk ($PERSIST_COUNT total)"
else
  fail "Original agent persisted to disk" "not found in file"
fi
if [ "$HAS_DUP" = "True" ]; then
  pass "Duplicated agent persisted to disk"
else
  fail "Duplicated agent persisted to disk" "not found in file"
fi

# ── 10. HEALTH — gateway_synced count ────────────────────────────────
echo ""
echo "── Test 10: Health reports gateway sync ──"
HEALTH=$(curl -sf "$BASE/api/features" | \
  python3 -c "
import sys,json
data=json.load(sys.stdin)
for f in data.get('features',[]):
    if f.get('name')=='agents_crud':
        h=f.get('health',{})
        print(f\"{h.get('gateway_synced',0)}|{h.get('total_agents',0)}\")
        break
else:
    print('0|0')
" 2>&1)
GW_SYNCED=$(echo "$HEALTH" | cut -d'|' -f1)
TOTAL=$(echo "$HEALTH" | cut -d'|' -f2)
if [ "$GW_SYNCED" -gt "0" ]; then
  pass "Health shows $GW_SYNCED/$TOTAL agents synced to gateway"
else
  fail "Health shows gateway_synced > 0" "synced=$GW_SYNCED total=$TOTAL"
fi

# ── 11. MODELS endpoint ─────────────────────────────────────────────
echo ""
echo "── Test 11: Models endpoint ──"
MODEL_COUNT=$(curl -sf "$BASE/api/agents/models" | \
  python3 -c "import sys,json; print(len(json.load(sys.stdin)['models']))")
if [ "$MODEL_COUNT" -gt "5" ]; then
  pass "Models endpoint returns $MODEL_COUNT models"
else
  fail "Models endpoint" "only $MODEL_COUNT models"
fi

# ── 12. DELETE — remove and verify ───────────────────────────────────
echo ""
echo "── Test 12: Delete Agent ──"
DEL=$(curl -sf -X DELETE "$BASE/api/agents/definitions/$AGENT_ID" | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('deleted','FAIL'))")
if [ "$DEL" = "$AGENT_ID" ]; then
  pass "Delete returned correct agent ID"
else
  fail "Delete returned correct agent ID" "got $DEL"
fi

# Verify it's gone from list
GONE_CHECK=$(curl -sf "$BASE/api/agents/definitions" | \
  python3 -c "
import sys,json
data=json.load(sys.stdin)
ids=[a['id'] for a in data['agents']]
print('GONE' if '$AGENT_ID' not in ids else 'STILL_THERE')
")
if [ "$GONE_CHECK" = "GONE" ]; then
  pass "Deleted agent removed from list"
else
  fail "Deleted agent removed from list" "$GONE_CHECK"
fi

# Verify it's gone from disk
DISK_GONE=$(python3 -c "
import json
with open('$HOME/.praisonaiui/agents.json') as f:
    data = json.load(f)
print('GONE' if '$AGENT_ID' not in data.get('agents',{}) else 'STILL_THERE')
" 2>&1)
if [ "$DISK_GONE" = "GONE" ]; then
  pass "Deleted agent removed from disk"
else
  fail "Deleted agent removed from disk" "$DISK_GONE"
fi

# Cleanup duplicate
curl -sf -X DELETE "$BASE/api/agents/definitions/$DUP_ID" > /dev/null 2>&1 || true

# ── 13. DELETE non-existent → 404 ───────────────────────────────────
echo ""
echo "── Test 13: Delete non-existent agent ──"
DEL_404=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/agents/definitions/fake_agent_xxx")
if [ "$DEL_404" = "404" ]; then
  pass "Delete non-existent returns 404"
else
  fail "Delete non-existent returns 404" "got $DEL_404"
fi

# ── 14. CREATE validation (empty name) ───────────────────────────────
echo ""
echo "── Test 14: Create with empty name → 400 ──"
EMPTY_NAME=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/agents/definitions" \
  -H "Content-Type: application/json" \
  -d '{"name":"","instructions":"test"}')
if [ "$EMPTY_NAME" = "400" ]; then
  pass "Create with empty name returns 400"
else
  fail "Create with empty name returns 400" "got $EMPTY_NAME"
fi

# ── 15. RUN with empty prompt → 400 ─────────────────────────────────
echo ""
echo "── Test 15: Run with empty prompt → 400 ──"
# Create a temp agent for this test
TEMP=$(curl -sf -X POST "$BASE/api/agents/definitions" \
  -H "Content-Type: application/json" \
  -d '{"name":"TempAgent","instructions":"test"}')
TEMP_ID=$(echo "$TEMP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
EMPTY_PROMPT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/agents/run/$TEMP_ID" \
  -H "Content-Type: application/json" \
  -d '{"prompt":""}')
if [ "$EMPTY_PROMPT" = "400" ]; then
  pass "Run with empty prompt returns 400"
else
  fail "Run with empty prompt returns 400" "got $EMPTY_PROMPT"
fi
curl -sf -X DELETE "$BASE/api/agents/definitions/$TEMP_ID" > /dev/null 2>&1 || true

# ── 16. STATUS filter in list ────────────────────────────────────────
echo ""
echo "── Test 16: List with status filter ──"
ACTIVE_COUNT=$(curl -sf "$BASE/api/agents/definitions?status=active" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
INACTIVE_COUNT=$(curl -sf "$BASE/api/agents/definitions?status=inactive" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
if [ "$ACTIVE_COUNT" -gt "0" ] && [ "$INACTIVE_COUNT" = "0" ]; then
  pass "Status filter: active=$ACTIVE_COUNT inactive=$INACTIVE_COUNT"
else
  fail "Status filter" "active=$ACTIVE_COUNT inactive=$INACTIVE_COUNT"
fi

# ═══════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed ($(( PASS + FAIL )) total)"
echo "═══════════════════════════════════════════════════════════"
for t in "${TESTS[@]}"; do echo "  $t"; done
echo ""
exit $FAIL
