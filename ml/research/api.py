"""Local-only processing API. NestJS supplies the authorized document scope."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .engine import (dense_embedding, extract_layout, extract_ocr, matric_candidates,
                     pages_from_file, visual_embedding, visual_query, visual_score)
from .store import PageStore

app = FastAPI(title="School Keep document research service")
store = PageStore()


class ProcessRequest(BaseModel):
    document_id: str
    school_id: str
    path: str
    media_type: str | None = None
    visual: bool = True


class SearchRequest(BaseModel):
    school_id: str
    allowed_ids: list[str] = Field(default_factory=list)
    query: str = Field(min_length=1)
    mode: str = "semantic"
    limit: int = Field(default=20, ge=1, le=100)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/process")
def process(request: ProcessRequest):
    path = Path(request.path).resolve()
    if not path.is_file():
        raise HTTPException(404, "Input file not found")
    analyses = []
    indexed = []
    for number, image in enumerate(pages_from_file(path, request.media_type), start=1):
        words = extract_ocr(image)
        text = "\n".join(word["text"] for word in words)
        layout = extract_layout(image, words)
        visual = visual_embedding(image) if request.visual else None
        indexed.append({"page": number, "text": text, "dense": dense_embedding(text), "visual": visual})
        analyses.append({"page": number, "text": text, "words": words,
                         "layout": layout, "matricCandidates": matric_candidates(words)})
    store.replace(request.document_id, request.school_id, indexed)
    return {"pages": analyses, "visualIndexed": request.visual}


@app.post("/search")
def search(request: SearchRequest):
    if request.mode not in {"semantic", "visual", "hybrid"}:
        raise HTTPException(400, "Invalid search mode")
    dense = store.dense_search(request.school_id, request.allowed_ids,
                               dense_embedding(request.query), request.limit) if request.mode != "visual" else []
    visual = []
    if request.mode != "semantic":
        query = visual_query(request.query)
        for row, embedding in store.visual_candidates(request.school_id, request.allowed_ids):
            visual.append({"documentId": row["document_id"], "page": row["page"],
                           "score": visual_score(query, embedding), "snippet": row["text"][:240]})
        visual.sort(key=lambda item: item["score"], reverse=True)
        visual = visual[:request.limit]
    if request.mode == "semantic":
        return {"results": dense}
    if request.mode == "visual":
        return {"results": visual}
    combined = {}
    for group in (dense, visual):
        for rank, item in enumerate(group, start=1):
            key = (item["documentId"], item["page"])
            entry = combined.setdefault(key, {**item, "score": 0.0})
            entry["score"] += 1 / (60 + rank)
    return {"results": sorted(combined.values(), key=lambda item: item["score"], reverse=True)[:request.limit]}


@app.delete("/index/{document_id}")
def delete(document_id: str):
    store.delete(document_id)
    return {"ok": True}
