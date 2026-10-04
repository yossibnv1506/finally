import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.services.fakes import FakeSource


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.setenv("MASSIVE_API_KEY", "")
    clients = []

    def factory(static_dir=None, snapshot_interval=None):
        holder = {}

        def source_factory(cache):
            holder["source"] = FakeSource(cache)
            return holder["source"]

        app = create_app(
            source_factory=source_factory,
            db_path=str(tmp_path / "api.db"),
            static_dir=static_dir or (tmp_path / "no-static"),
            snapshot_interval=snapshot_interval,
            load_dotenv=False,
        )
        client = TestClient(app)
        client.__enter__()  # run lifespan
        clients.append(client)
        client.source = holder["source"]
        return client

    yield factory
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client):
    return make_client()
