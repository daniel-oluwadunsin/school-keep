import pytest

from scripts.eval_usability import summarize


def test_usability_scores_actual_rows():
    rows = [
        {"respondent_id": "anon-1", "role": "student", "document_retrieval": "5",
         "clearance_processing_efficiency": "4", "ease_of_use": "3"},
        {"respondent_id": "anon-2", "role": "administrator", "document_retrieval": "3",
         "clearance_processing_efficiency": "4", "ease_of_use": "5"},
    ]
    result = summarize(rows)
    assert result["sample_size"] == {"student": 1, "administrator": 1}
    assert result["usability"]["overall_percent"] == 80
    assert not result["target_met"]


def test_usability_rejects_duplicate_respondents():
    row = {"respondent_id": "anon-1", "role": "student", "document_retrieval": "5",
           "clearance_processing_efficiency": "4", "ease_of_use": "3"}
    with pytest.raises(ValueError, match="unique respondent_id"):
        summarize([row, row])
