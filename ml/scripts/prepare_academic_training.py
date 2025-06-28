"""Prepare a small, real academic form classifier dataset.

Public blank university PDFs are downloaded locally; no documents or weights
are committed. This dataset is a demonstration and not a student-record corpus.
"""

import json
from pathlib import Path

from research.engine import extract_ocr, pages_from_file
from scripts.eval_academic_forms import FORMS, fetch_form


def main():
    inputs = {name: (url, "Student Clearance" if "clearance" in name.lower()
                     else "Transcript Request") for name, url in FORMS.items()}
    rows = []
    failures = {}
    for name, (url, label) in inputs.items():
        try:
            path = fetch_form(name, url)
            for page_number, image in enumerate(pages_from_file(path, "application/pdf"), 1):
                rows.append({"documentId": name, "label": label,
                             "path": str(path.resolve()), "mediaType": "application/pdf",
                             "page": page_number, "words": extract_ocr(image)})
        except Exception as error:
            failures[name] = str(error)
    if len({row["documentId"] for row in rows if row["label"] == "Student Clearance"}) < 2 or \
       len({row["documentId"] for row in rows if row["label"] == "Transcript Request"}) < 2:
        raise SystemExit(f"Too few source forms: {failures}")
    output = Path("data/academic-training-export.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"data": rows, "sources": inputs, "failures": failures}, indent=2))
    print(output)


if __name__ == "__main__":
    main()
