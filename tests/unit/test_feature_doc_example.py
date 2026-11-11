"""Smoke test for the feature-module example in docs/features/how-to-add-a-feature.md (#335)."""

from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from praisonaiui.features import BaseFeatureProtocol, _features, register_feature
from praisonaiui.server import create_app


# Mirrors section 7 of docs/features/how-to-add-a-feature.md — keep in sync.
class MyFeature(BaseFeatureProtocol):
    name = "my-feature"
    description = "Example feature with GET and PATCH routes"

    def routes(self):
        return [
            Route("/api/my-feature", self._get, methods=["GET"]),
            Route("/api/my-feature/{item_id}", self._patch, methods=["PATCH"]),
        ]

    async def _get(self, request):
        return JSONResponse({"data": request.query_params.get("q", "hello")})

    async def _patch(self, request):
        body = await request.json()
        return JSONResponse({"ok": True, "id": request.path_params["item_id"], **body})


def test_doc_feature_example_routes():
    saved = dict(_features)
    try:
        register_feature(MyFeature())
        client = TestClient(create_app())

        r = client.get("/api/my-feature", params={"q": "hi"})
        assert r.status_code == 200
        assert r.json() == {"data": "hi"}

        r = client.patch("/api/my-feature/42", json={"title": "x"})
        assert r.status_code == 200
        assert r.json() == {"ok": True, "id": "42", "title": "x"}
    finally:
        _features.clear()
        _features.update(saved)
