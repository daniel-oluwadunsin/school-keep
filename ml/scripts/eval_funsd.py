"""Evaluate OCR and LayoutLMv3 on the annotated FUNSD test split.

Download FUNSD yourself after reading its research-use terms, then pass the
directory containing testing_data/images and testing_data/annotations.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from research.engine import extract_layout, extract_ocr
from research.metrics import error_rate


def inside(box, outer):
    x = (box[0] + box[2]) / 2
    y = (box[1] + box[3]) / 2
    return outer[0] <= x <= outer[2] and outer[1] <= y <= outer[3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    root = args.dataset / "testing_data"
    annotations = sorted((root / "annotations").glob("*.json"))
    if not annotations:
        raise SystemExit("No FUNSD testing_data/annotations found")
    ocr_rows = []
    correct = predicted_total = actual_total = 0
    for annotation_path in annotations:
        image_path = root / "images" / f"{annotation_path.stem}.png"
        if not image_path.exists():
            continue
        image = Image.open(image_path).convert("RGB")
        truth = json.loads(annotation_path.read_text())["form"]
        words = extract_ocr(image)
        layout = extract_layout(image, words)
        truth_text = " ".join(entity["text"] for entity in truth)
        ocr_text = " ".join(word["text"] for word in words)
        ocr_rows.append({"document": annotation_path.stem,
                         "cer": error_rate(ocr_text, truth_text),
                         "wer": error_rate(ocr_text, truth_text, unit="word")})
        actual = [entity for entity in truth if entity["label"] != "other"]
        actual_total += len(actual)
        predictions = layout["entities"]
        predicted_total += len(predictions)
        matched = set()
        for prediction in predictions:
            label = prediction["label"].split("-")[-1].lower()
            for index, entity in enumerate(actual):
                if index not in matched and label == entity["label"].lower() and inside(prediction["box"], entity["box"]):
                    matched.add(index)
                    correct += 1
                    break
    precision = correct / max(1, predicted_total)
    recall = correct / max(1, actual_total)
    report = {"dataset": "FUNSD official test split (research use)",
              "sample_size": len(ocr_rows), "ocr": ocr_rows,
              "extraction": {"entity_precision": precision, "entity_recall": recall,
                             "entity_f1": 2 * precision * recall / max(1e-12, precision + recall)},
              "models": {"ocr": "PaddleOCR 3.x", "extraction": "nielsr/layoutlmv3-finetuned-funsd"},
              "method": "FUNSD annotated text and entity boxes are the reference. Predicted entity labels count as correct when the word-box center falls in a matching annotated entity."}
    Path("results").mkdir(exist_ok=True)
    path = Path("results") / f"funsd-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps(report, indent=2))
    print(path)


if __name__ == "__main__":
    main()
