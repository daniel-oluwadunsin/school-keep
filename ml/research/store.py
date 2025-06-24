"""Durable page metadata; FAISS is rebuilt from the stored dense vectors."""

import io
import os
import sqlite3
from pathlib import Path

import faiss
import numpy as np


def _pack(value):
    output = io.BytesIO()
    np.save(output, np.asarray(value, dtype=np.float32), allow_pickle=False)
    return output.getvalue()


def _unpack(value):
    return np.load(io.BytesIO(value), allow_pickle=False)


class PageStore:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("ML_INDEX_DB", "indexes/pages.sqlite"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE IF NOT EXISTS pages (
            document_id TEXT NOT NULL, school_id TEXT NOT NULL,
            page INTEGER NOT NULL, text TEXT NOT NULL,
            dense BLOB NOT NULL, visual BLOB,
            PRIMARY KEY(document_id, page))""")
        self.db.commit()

    def replace(self, document_id, school_id, pages):
        with self.db:
            self.db.execute("DELETE FROM pages WHERE document_id=?", (document_id,))
            self.db.executemany(
                "INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?)",
                [(document_id, school_id, p["page"], p["text"],
                  _pack(p["dense"]), _pack(p["visual"]) if p.get("visual") is not None else None)
                 for p in pages],
            )

    def delete(self, document_id):
        with self.db:
            self.db.execute("DELETE FROM pages WHERE document_id=?", (document_id,))

    def candidates(self, school_id, allowed_ids):
        if not allowed_ids:
            return []
        ids = list(dict.fromkeys(allowed_ids))
        placeholders = ",".join("?" for _ in ids)
        return self.db.execute(
            f"SELECT * FROM pages WHERE school_id=? AND document_id IN ({placeholders})",
            [school_id, *ids],
        ).fetchall()

    def dense_search(self, school_id, allowed_ids, vector, limit=20):
        rows = self.candidates(school_id, allowed_ids)
        if not rows:
            return []
        vectors = np.stack([_unpack(row["dense"]) for row in rows]).astype("float32")
        faiss.normalize_L2(vectors)
        query = np.asarray(vector, dtype="float32").reshape(1, -1)
        faiss.normalize_L2(query)
        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)
        scores, positions = index.search(query, min(limit, len(rows)))
        return [{"documentId": rows[i]["document_id"], "page": rows[i]["page"],
                 "score": float(score), "snippet": rows[i]["text"][:240]}
                for score, i in zip(scores[0], positions[0]) if i >= 0]

    def visual_candidates(self, school_id, allowed_ids):
        return [(row, _unpack(row["visual"])) for row in self.candidates(school_id, allowed_ids)
                if row["visual"] is not None]
