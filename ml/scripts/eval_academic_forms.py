"""OCR evaluation on public Nigerian university PDFs plus synthetic matching cases."""

import json
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont
import pypdfium2 as pdfium

from research.engine import extract_ocr, matric_candidates, pages_from_file
from research.metrics import error_rate, field_scores, matching_scores


FORMS = {
    "Bowen transcript request": "https://bowen.edu.ng/wp-content/uploads/2020/04/transcript-request-form.pdf",
    "UNIPORT transcript application": "https://www.uniport.edu.ng/wp-content/uploads/2024/11/APPLICATION_FORMAT.pdf",
    "YMSU student clearance": "https://nwu.edu.ng/wordpress/wp-content/uploads/2021/12/NYSC-CLEARANCE-FORM.pdf",
    "ABU exit clearance": "https://abu.edu.ng/wp-content/uploads/2023/09/Exit-Clearence-Form.pdf",
}


def fetch_form(name, url):
    path = Path("data/forms") / (name.lower().replace(" ", "-") + ".pdf")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        if not response.content.startswith(b"%PDF"):
            raise ValueError("Source is not a PDF")
        path.write_bytes(response.content)
    return path


def ocr_pdf(name, path):
    pdf = pdfium.PdfDocument(path)
    pages = pages_from_file(path, "application/pdf")
    output = []
    for index, image in enumerate(pages):
        truth = pdf[index].get_textpage().get_text_range()
        prediction = " ".join(word["text"] for word in extract_ocr(image))
        output.append({"document": name, "page": index + 1,
                       "cer": error_rate(prediction, truth),
                       "wer": error_rate(prediction, truth, unit="word")})
    return output


def synthetic_records():
    """Only for matching; these identities and filled forms are fabricated."""
    records = ["SK/CSC/2021/001", "SK/CSC/2021/002", "SK/BUS/2020/003"]
    cases = [records[0], records[1], records[2], "SK/CSC/2021/999", ""]
    predictions = []
    truths = []
    fields_predicted = []
    fields_truth = []
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
    for index, matric in enumerate(cases):
        image = Image.new("RGB", (1200, 700), "white")
        draw = ImageDraw.Draw(image)
        draw.text((70, 70), "STUDENT CLEARANCE FORM", font=font, fill="black")
        draw.text((70, 180), "Name of Student: Demo Student", font=font, fill="black")
        draw.text((70, 280), f"Matriculation No: {matric}", font=font, fill="black")
        draw.text((70, 380), "Department: Computer Science", font=font, fill="black")
        words = extract_ocr(image)
        candidates = matric_candidates(words)
        confident = [item["value"] for item in candidates if item["confidence"] >= 0.95]
        normalized = [value.replace("/", "").replace("-", "") for value in confident]
        matched = next((record for record in records if record.replace("/", "") in normalized), None)
        truth = matric if matric in records else None
        predictions.append(matched)
        truths.append(truth)
        fields_predicted.append({"matricNumber": candidates[0]["value"] if candidates else ""})
        fields_truth.append({"matricNumber": matric})
    return matching_scores(predictions, truths), field_scores(fields_predicted, fields_truth)


def main():
    ocr = []
    failures = {}
    for name, url in FORMS.items():
        try:
            ocr.extend(ocr_pdf(name, fetch_form(name, url)))
        except Exception as error:
            failures[name] = str(error)
    matching, fields = synthetic_records()
    report = {"dataset": "Public Nigerian university blank forms and synthetic filled examples",
              "sources": FORMS, "sample_size": {"ocr_pages": len(ocr), "matching_cases": 5},
              "ocr": ocr, "extraction": {"synthetic_matric_field": fields},
              "matching": matching, "source_errors": failures,
              "models": {"ocr": "PaddleOCR 3.x"},
              "method": "OCR reference text is embedded PDF text, so it is an approximate ground truth. Matching uses synthetic student identities. No real student data or usability measurements are included."}
    Path("results").mkdir(exist_ok=True)
    path = Path("results") / f"academic-forms-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps(report, indent=2))
    print(path)


if __name__ == "__main__":
    main()
