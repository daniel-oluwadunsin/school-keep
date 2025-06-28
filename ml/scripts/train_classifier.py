"""Fine-tune LayoutLMv3 on admin-reviewed school document types.

Export GET /api/v1/document/training-export to a JSON file first. The export
contains local paths, so run this script on the same computer as the API.
"""

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoProcessor

from research.engine import pages_from_file


def encode(row, processor):
    image = pages_from_file(row["path"], row.get("mediaType"))[row["page"] - 1]
    words = row["words"]
    width, height = image.size
    boxes = [[min(1000, max(0, round(1000 * value / (width if index % 2 == 0 else height))))
              for index, value in enumerate(word["box"])] for word in words]
    return processor(image, [word["text"] for word in words], boxes=boxes,
                     truncation=True, padding="max_length", return_tensors="pt")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("export", type=Path)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--output", type=Path, default=Path("models/layout-classifier"))
    args = parser.parse_args()
    loaded = json.loads(args.export.read_text())
    rows = loaded.get("data", loaded) if isinstance(loaded, dict) else loaded
    counts = Counter(row["label"] for row in rows)
    if len(counts) < 2 or min(counts.values()) < 2:
        raise SystemExit("Need at least two reviewed examples per document type and two types")
    labels = sorted(counts)
    label2id = {label: index for index, label in enumerate(labels)}
    model_name = "microsoft/layoutlmv3-base"
    processor = AutoProcessor.from_pretrained(model_name, apply_ocr=False)
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name, num_labels=len(labels), id2label={i: label for label, i in label2id.items()},
        label2id=label2id,
    )
    by_label = {label: [row for row in rows if row["label"] == label] for label in labels}
    train_rows, test_rows = [], []
    for label, examples in by_label.items():
        documents = list(dict.fromkeys(row["documentId"] for row in examples))
        if len(documents) < 2:
            raise SystemExit(f"Need at least two different documents for {label}")
        random.Random(42).shuffle(documents)
        test_id = documents[0]
        test_rows.extend(row for row in examples if row["documentId"] == test_id)
        train_rows.extend(row for row in examples if row["documentId"] != test_id)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-5)
    model.train()
    for epoch in range(args.epochs):
        random.Random(42 + epoch).shuffle(train_rows)
        for row in train_rows:
            inputs = {key: value.to(device) for key, value in encode(row, processor).items()}
            loss = model(**inputs, labels=torch.tensor([label2id[row["label"]]], device=device)).loss
            loss.backward()
            optimizer.step()
            optimizer.zero_grad()
        print(f"Epoch {epoch + 1}/{args.epochs} complete")
    model.eval()
    correct = 0
    with torch.no_grad():
        for row in test_rows:
            inputs = {key: value.to(device) for key, value in encode(row, processor).items()}
            predicted = int(model(**inputs).logits.argmax(-1))
            correct += predicted == label2id[row["label"]]
    args.output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.output)
    processor.save_pretrained(args.output)
    report = {"labels": labels, "train_size": len(train_rows), "test_size": len(test_rows),
              "test_accuracy": correct / len(test_rows), "epochs": args.epochs, "seed": 42}
    (args.output / "training_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
