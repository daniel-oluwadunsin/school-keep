import numpy as np

from research.store import PageStore


def test_dense_search_respects_school_and_allowed_ids(tmp_path):
    store = PageStore(tmp_path / "pages.sqlite")
    store.replace("doc-a", "school-a", [{"page": 1, "text": "student clearance",
        "dense": np.array([1, 0]), "visual": np.array([[1, 0]])}])
    store.replace("doc-b", "school-b", [{"page": 1, "text": "private record",
        "dense": np.array([1, 0]), "visual": None}])
    assert [hit["documentId"] for hit in store.dense_search(
        "school-a", ["doc-a", "doc-b"], [1, 0])] == ["doc-a"]
    assert store.dense_search("school-a", ["doc-b"], [1, 0]) == []
    store.delete("doc-a")
    assert store.dense_search("school-a", ["doc-a"], [1, 0]) == []


def test_replace_removes_old_page_vectors(tmp_path):
    store = PageStore(tmp_path / "pages.sqlite")
    store.replace("doc-a", "school-a", [{"page": 1, "text": "old",
        "dense": [1, 0], "visual": None}])
    store.replace("doc-a", "school-a", [{"page": 2, "text": "new",
        "dense": [0, 1], "visual": None}])
    hits = store.dense_search("school-a", ["doc-a"], [0, 1])
    assert len(hits) == 1
    assert hits[0]["page"] == 2
