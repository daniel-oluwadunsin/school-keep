"""Compare keyword, Sentence-BERT/FAISS and ColPali on ViDoRe ArxivQA."""

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import faiss
import numpy as np
from datasets import load_dataset

from research.engine import dense_embedding, extract_ocr, visual_embedding, visual_query, visual_score
from research.metrics import retrieval_scores


def keyword_scores(query, texts):
    terms = set(re.findall(r"\w+", query.lower()))
    return [len(terms & set(re.findall(r"\w+", text.lower()))) for text in texts]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--skip-visual", action="store_true")
    args = parser.parse_args()
    dataset = load_dataset("vidore/arxivqa_test_subsampled", split="test")
    rows = list(dataset.select(range(min(args.samples, len(dataset)))))
    corpus = {}
    for row in rows:
        corpus[row["image_filename"]] = row["image"].convert("RGB")
    ids = list(corpus)
    texts = [" ".join(word["text"] for word in extract_ocr(image)) for image in corpus.values()]
    dense = np.stack([dense_embedding(text) for text in texts]).astype("float32")
    faiss.normalize_L2(dense)
    index = faiss.IndexFlatIP(dense.shape[1])
    index.add(dense)
    visual = [visual_embedding(image) for image in corpus.values()] if not args.skip_visual else []
    rankings = {mode: [] for mode in ("keyword", "semantic", "visual", "hybrid")}
    relevant = []
    for row in rows:
        query = row["query"]
        relevant.append([row["image_filename"]])
        keyword = np.argsort(-np.asarray(keyword_scores(query, texts))).tolist()
        _, dense_positions = index.search(dense_embedding(query).reshape(1, -1), len(ids))
        semantic = dense_positions[0].tolist()
        rankings["keyword"].append([ids[i] for i in keyword])
        rankings["semantic"].append([ids[i] for i in semantic])
        if visual:
            q = visual_query(query)
            visual_positions = sorted(range(len(ids)), key=lambda i: visual_score(q, visual[i]), reverse=True)
            rankings["visual"].append([ids[i] for i in visual_positions])
            rrf = {i: 1 / (60 + keyword.index(i) + 1) + 1 / (60 + semantic.index(i) + 1)
                   + 1 / (60 + visual_positions.index(i) + 1) for i in range(len(ids))}
            rankings["hybrid"].append([ids[i] for i in sorted(rrf, key=rrf.get, reverse=True)])
    scores = {mode: retrieval_scores(values, relevant) for mode, values in rankings.items() if values}
    output = {"dataset": "vidore/arxivqa_test_subsampled (CC BY-SA 4.0)",
              "sample_size": len(rows), "retrieval": scores,
              "models": {"semantic": "sentence-transformers/all-MiniLM-L6-v2",
                         "visual": "vidore/colpali-v1.3" if visual else "skipped"},
              "method": "Same page corpus and query set for all modes; OCR text is used for keyword and semantic baselines. Hybrid uses reciprocal rank fusion."}
    Path("results").mkdir(exist_ok=True)
    path = Path("results") / f"vidore-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps(output, indent=2))
    print(path)


if __name__ == "__main__":
    main()
