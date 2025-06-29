"""Summarize anonymous 1–5 usability responses from actual participants."""

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


CRITERIA = ("document_retrieval", "clearance_processing_efficiency", "ease_of_use")
ROLES = ("student", "administrator")
TARGETS = {"student": 50, "administrator": 15}


def summarize(rows):
    counts = Counter()
    values = {key: [] for key in CRITERIA}
    seen = set()
    for number, row in enumerate(rows, 2):
        role = row.get("role", "").strip().lower()
        respondent = row.get("respondent_id", "").strip()
        if role not in ROLES or not respondent or respondent in seen:
            raise ValueError(f"Row {number}: role or unique respondent_id is invalid")
        seen.add(respondent)
        counts[role] += 1
        for key in CRITERIA:
            try:
                rating = int(row.get(key, ""))
            except (TypeError, ValueError) as error:
                raise ValueError(f"Row {number}: {key} must be an integer from 1 to 5") from error
            if not 1 <= rating <= 5:
                raise ValueError(f"Row {number}: {key} must be an integer from 1 to 5")
            values[key].append(rating)
    if not seen:
        raise ValueError("No responses found")
    criterion_percent = {key: round(100 * sum(ratings) / (5 * len(ratings)), 2)
                         for key, ratings in values.items()}
    overall = round(sum(criterion_percent.values()) / len(CRITERIA), 2)
    return {"dataset": "Anonymous School Keep usability responses",
            "sample_size": dict(counts), "target_sample_size": TARGETS,
            "target_met": all(counts[role] >= TARGETS[role] for role in ROLES),
            "usability": {"criterion_percent": criterion_percent, "overall_percent": overall},
            "method": "Each criterion is rated 1–5. Criterion percentage is mean rating divided by 5, multiplied by 100. Overall percentage is the mean of the three criterion percentages. This scoring method may differ from the thesis's 88.73% calculation."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("responses", type=Path, help="CSV with respondent_id, role and three rating columns")
    args = parser.parse_args()
    with args.responses.open(newline="") as stream:
        report = summarize(csv.DictReader(stream))
    Path("results").mkdir(exist_ok=True)
    output = Path("results") / f"usability-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    output.write_text(json.dumps(report, indent=2))
    print(output)


if __name__ == "__main__":
    main()
