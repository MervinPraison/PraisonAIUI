"""Comprehensive test for all 8 protocol-driven gap implementations.

Tests protocol compliance, API endpoints, and feature registration
for: Memory, MediaAnalysis, TTS, Marketplace, CodeExecution, PWA, i18n, DevicePairing.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# Reset singletons before app creation
from praisonaiui.features import memory as _mem
_mem._memory_manager = None

from starlette.testclient import TestClient
from praisonaiui.server import create_app

app = create_app()
client = TestClient(app)
passed = failed = 0
errors = []


def check(name, r, status=200, keys=None, contains=None):
    global passed, failed
    try:
        assert r.status_code == status, f"Expected {status}, got {r.status_code}: {r.text[:200]}"
        if keys:
            data = r.json()
            for k in keys:
                assert k in data, f"Missing '{k}' in {list(data.keys())}"
        if contains:
            assert contains in r.text, f"'{contains}' not in response"
        passed += 1
        print(f"  ✓ {name}")
    except AssertionError as e:
        failed += 1
        errors.append(f"  ✗ {name}: {e}")
        print(f"  ✗ {name}: {e}")


# ── Feature Registration ─────────────────────────────────────────────
print("\n═══ Feature Registration ═══")
from praisonaiui.features import get_features

features = get_features()
NEW_FEATURES = ["memory", "media_analysis", "tts", "marketplace", "code_execution", "pwa", "i18n", "device_pairing"]

for feat_name in NEW_FEATURES:
    if feat_name in features:
        passed += 1
        print(f"  ✓ {feat_name} registered")
    else:
        failed += 1
        errors.append(f"  ✗ {feat_name} not registered")
        print(f"  ✗ {feat_name} not registered")

print(f"  Total features: {len(features)}")


# ── Protocol Compliance ──────────────────────────────────────────────
print("\n═══ Protocol Compliance ═══")
from abc import ABC

# Memory
from praisonaiui.features.memory import MemoryProtocol, SimpleMemoryManager, SDKMemoryManager
assert issubclass(MemoryProtocol, ABC); passed += 1; print("  ✓ MemoryProtocol is ABC")
assert isinstance(SimpleMemoryManager(), MemoryProtocol); passed += 1; print("  ✓ SimpleMemoryManager")
assert isinstance(SDKMemoryManager(), MemoryProtocol); passed += 1; print("  ✓ SDKMemoryManager")

# TTS
from praisonaiui.features.tts import TTSProtocol, BrowserTTSManager, OpenAITTSManager
assert issubclass(TTSProtocol, ABC); passed += 1; print("  ✓ TTSProtocol is ABC")
assert isinstance(BrowserTTSManager(), TTSProtocol); passed += 1; print("  ✓ BrowserTTSManager")
assert isinstance(OpenAITTSManager(), TTSProtocol); passed += 1; print("  ✓ OpenAITTSManager")

# Marketplace
from praisonaiui.features.marketplace import MarketplaceProtocol, LocalMarketplaceManager
assert issubclass(MarketplaceProtocol, ABC); passed += 1; print("  ✓ MarketplaceProtocol is ABC")
assert isinstance(LocalMarketplaceManager(), MarketplaceProtocol); passed += 1; print("  ✓ LocalMarketplaceManager")

# Code Execution
from praisonaiui.features.code_execution import CodeExecutionProtocol, SandboxExecutionManager
assert issubclass(CodeExecutionProtocol, ABC); passed += 1; print("  ✓ CodeExecutionProtocol is ABC")
assert isinstance(SandboxExecutionManager(), CodeExecutionProtocol); passed += 1; print("  ✓ SandboxExecutionManager")

# PWA
from praisonaiui.features.pwa import PWAProtocol, DefaultPWAManager
assert issubclass(PWAProtocol, ABC); passed += 1; print("  ✓ PWAProtocol is ABC")
assert isinstance(DefaultPWAManager(), PWAProtocol); passed += 1; print("  ✓ DefaultPWAManager")

# i18n
from praisonaiui.features.i18n import I18nProtocol, JSONLocaleManager
assert issubclass(I18nProtocol, ABC); passed += 1; print("  ✓ I18nProtocol is ABC")
assert isinstance(JSONLocaleManager(), I18nProtocol); passed += 1; print("  ✓ JSONLocaleManager")

# Device Pairing
from praisonaiui.features.device_pairing import PairingProtocol, DefaultPairingManager
assert issubclass(PairingProtocol, ABC); passed += 1; print("  ✓ PairingProtocol is ABC")
assert isinstance(DefaultPairingManager(), PairingProtocol); passed += 1; print("  ✓ DefaultPairingManager")

# Media Analysis
from praisonaiui.features.media_analysis import MediaAnalysisProtocol, VisionAnalysisManager
assert issubclass(MediaAnalysisProtocol, ABC); passed += 1; print("  ✓ MediaAnalysisProtocol is ABC")
assert isinstance(VisionAnalysisManager(), MediaAnalysisProtocol); passed += 1; print("  ✓ VisionAnalysisManager")


# ── API: TTS ─────────────────────────────────────────────────────────
print("\n═══ TTS API ═══")
check("GET /api/tts/voices", client.get("/api/tts/voices"), 200, ["voices", "count"])
r = client.post("/api/tts/synthesize", json={"text": "Hello world", "voice": "default"})
check("POST /api/tts/synthesize", r, 200, ["type", "text"])
assert r.json()["type"] == "browser_speech"


# ── API: Marketplace ─────────────────────────────────────────────────
print("\n═══ Marketplace API ═══")
check("GET /api/marketplace/plugins", client.get("/api/marketplace/plugins"), 200, ["plugins", "count"])
r = client.post("/api/marketplace/search", json={"query": "search"})
check("POST search", r, 200, ["results"])
r = client.post("/api/marketplace/install", json={"plugin_id": "web_search"})
check("POST install", r, 200, ["status"])
assert r.json()["status"] == "installed"
check("GET plugin detail", client.get("/api/marketplace/plugins/web_search"), 200, ["id"])
r = client.post("/api/marketplace/uninstall", json={"plugin_id": "web_search"})
check("POST uninstall", r, 200, ["status"])
check("GET nonexistent plugin", client.get("/api/marketplace/plugins/nonexistent"), 404)


# ── API: Code Execution ─────────────────────────────────────────────
print("\n═══ Code Execution API ═══")
check("GET /api/code/languages", client.get("/api/code/languages"), 200, ["languages", "count"])
r = client.post("/api/code/execute", json={"code": "print('hello')", "language": "python"})
check("POST /api/code/execute", r, 200, ["status", "language"])
r = client.post("/api/code/execute", json={"code": "ls", "language": "ruby"})
check("POST execute disallowed lang", r, 400, ["error"])


# ── API: PWA ─────────────────────────────────────────────────────────
print("\n═══ PWA API ═══")
r = client.get("/manifest.json")
check("GET /manifest.json", r, 200)
assert "PraisonAI" in r.text
r = client.get("/sw.js")
check("GET /sw.js", r, 200)
assert "Service Worker" in r.text
check("GET /api/pwa/config", client.get("/api/pwa/config"), 200, ["manifest", "has_sw"])


# ── API: i18n ────────────────────────────────────────────────────────
print("\n═══ i18n API ═══")
check("GET /api/i18n/locales", client.get("/api/i18n/locales"), 200, ["locales", "count"])
r = client.get("/api/i18n/strings/en")
check("GET /api/i18n/strings/en", r, 200, ["strings", "count"])
assert "app.title" in r.json()["strings"]
check("GET /api/i18n/strings/es", client.get("/api/i18n/strings/es"), 200)
check("GET unknown locale", client.get("/api/i18n/strings/xx"), 404)
r = client.post("/api/i18n/translate", json={"key": "app.welcome", "locale": "es"})
check("POST translate", r, 200, ["text"])
assert "Bienvenido" in r.json()["text"]
check("GET locale", client.get("/api/i18n/locale"), 200, ["locale"])
r = client.post("/api/i18n/locale", json={"locale": "fr"})
check("POST set locale", r, 200, ["locale"])
assert r.json()["locale"] == "fr"


# ── API: Device Pairing ─────────────────────────────────────────────
print("\n═══ Device Pairing API ═══")
r = client.post("/api/pairing/create", json={"session_id": "test-session"})
check("POST /api/pairing/create", r, 201, ["code", "session_id"])
code = r.json()["code"]
r = client.post("/api/pairing/validate", json={"code": code})
check("POST /api/pairing/validate (valid)", r, 200, ["valid", "device_id"])
assert r.json()["valid"] is True
device_id = r.json()["device_id"]
r = client.post("/api/pairing/validate", json={"code": code})
check("POST validate (reused code)", r, 400)
r = client.get("/api/pairing/devices?session_id=test-session")
check("GET /api/pairing/devices", r, 200, ["devices", "count"])
assert r.json()["count"] == 1
check("DELETE device", client.delete(f"/api/pairing/devices/{device_id}"), 200, ["deleted"])
check("DELETE nonexistent device", client.delete("/api/pairing/devices/xxx"), 404)


# ── API: Media Analysis ─────────────────────────────────────────────
print("\n═══ Media Analysis API ═══")
check("GET capabilities", client.get("/api/media/capabilities"), 200, ["capabilities", "count"])
r = client.post("/api/media/analyze", json={"url": "https://example.com/img.png", "prompt": "Describe"})
check("POST /api/media/analyze", r, 200, ["analysis", "status"])
r = client.post("/api/media/analyze", json={})
check("POST analyze no image", r, 400, ["error"])
r = client.post("/api/media/ocr", json={"url": "https://example.com/doc.png"})
check("POST /api/media/ocr", r, 200, ["text", "status"])


# ── API: Features listing ───────────────────────────────────────────
print("\n═══ Features Listing ═══")
r = client.get("/api/features")
check("GET /api/features", r, 200, ["features"])
feature_names = [f["name"] for f in r.json()["features"]]
for fn in NEW_FEATURES:
    if fn in feature_names:
        passed += 1
        print(f"  ✓ {fn} in /api/features")
    else:
        failed += 1
        errors.append(f"  ✗ {fn} not in /api/features response")
        print(f"  ✗ {fn} not in /api/features response")


# ── Summary ──────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"  ALL GAPS: {passed} passed, {failed} failed")
print(f"{'='*60}")
if errors:
    print("\nFailures:")
    for e in errors:
        print(e)
    sys.exit(1)
