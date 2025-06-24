from research.metrics import error_rate, field_scores, matching_scores, retrieval_scores


def test_error_rates_and_fields():
    assert error_rate("a b", "a b") == 0
    assert error_rate("a x", "a b", unit="word") == 0.5
    assert field_scores([{"matric": "A1"}], [{"matric": "A1"}])["f1"] == 1


def test_retrieval_and_matching():
    scores = retrieval_scores([["wrong", "right"]], [["right"]])
    assert scores["recall@1"] == 0
    assert scores["recall@5"] == 1
    assert scores["mrr"] == 0.5
    assert matching_scores(["A", "B", None], ["A", "C", "D"])["precision"] == 0.5
