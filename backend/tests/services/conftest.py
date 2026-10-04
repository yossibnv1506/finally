import pytest

from app import db
from app.market import PriceCache

from .fakes import FakeSource


@pytest.fixture
def temp_db(tmp_path):
    path = str(tmp_path / "test.db")
    db.init_db(path)
    return path


@pytest.fixture
def cache():
    return PriceCache()


@pytest.fixture
async def source(temp_db, cache):
    from app.services import tracked_tickers

    src = FakeSource(cache)
    await src.start(tracked_tickers())
    return src
