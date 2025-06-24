"""Evaluation metrics shared by the benchmark runner and Streamlit dashboard."""

import math
import re


def normalize(text):
    return re.sub(r"\s+", " ", text.strip().lower())


def edit_distance(left, right):
    previous = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        current = [i]
        for j, b in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (a != b)))
        previous = current
    return previous[-1]


def error_rate(prediction, truth, unit="character"):
    actual = normalize(truth)
    guess = normalize(prediction)
    if unit == "word":
        actual, guess = actual.split(), guess.split()
    return edit_distance(guess, actual) / max(1, len(actual))


def field_scores(predictions, truths):
    true_positive = false_positive = false_negative = 0
    for prediction, truth in zip(predictions, truths):
        for key in set(prediction) | set(truth):
            predicted = normalize(str(prediction.get(key, "")))
            expected = normalize(str(truth.get(key, "")))
            if predicted and expected and predicted == expected:
                true_positive += 1
            else:
                false_positive += bool(predicted)
                false_negative += bool(expected)
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {"precision": precision, "recall": recall,
            "f1": 2 * precision * recall / max(1e-12, precision + recall)}


def retrieval_scores(rankings, relevant, ks=(1, 5, 10)):
    output = {f"recall@{k}": 0.0 for k in ks}
    output.update({"mrr": 0.0, "ndcg@10": 0.0})
    if not relevant:
        return output
    for ranking, gold in zip(rankings, relevant):
        gold = set(gold)
        for k in ks:
            output[f"recall@{k}"] += len(set(ranking[:k]) & gold) / max(1, len(gold))
        for rank, item in enumerate(ranking, 1):
            if item in gold:
                output["mrr"] += 1 / rank
                break
        dcg = sum(1 / math.log2(rank + 2) for rank, item in enumerate(ranking[:10]) if item in gold)
        ideal = sum(1 / math.log2(rank + 2) for rank in range(min(10, len(gold))))
        output["ndcg@10"] += dcg / max(1e-12, ideal)
    return {key: value / len(relevant) for key, value in output.items()}


def matching_scores(predictions, truths):
    true_positive = false_positive = false_negative = 0
    for prediction, truth in zip(predictions, truths):
        true_positive += bool(prediction and prediction == truth)
        false_positive += bool(prediction and prediction != truth)
        false_negative += bool(truth and prediction != truth)
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {"precision": precision, "recall": recall,
            "f1": 2 * precision * recall / max(1e-12, precision + recall)}
