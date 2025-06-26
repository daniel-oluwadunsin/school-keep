"""PaddleOCR, LayoutLMv3, Sentence-BERT and ColPali adapters."""

import os
import re
from functools import lru_cache

import numpy as np
from PIL import Image


@lru_cache(maxsize=1)
def ocr_model():
    from paddleocr import PaddleOCR
    return PaddleOCR(use_doc_orientation_classify=False,
                     use_doc_unwarping=False, use_textline_orientation=False)


@lru_cache(maxsize=1)
def text_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(os.getenv("SBERT_MODEL", "sentence-transformers/all-MiniLM-L6-v2"))


@lru_cache(maxsize=1)
def visual_model():
    import torch
    from colpali_engine.models import ColPali, ColPaliProcessor
    name = os.getenv("COLPALI_MODEL", "vidore/colpali-v1.3")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ColPali.from_pretrained(name, torch_dtype=torch.float16 if device == "mps" else torch.float32,
                                    device_map=device).eval()
    return model, ColPaliProcessor.from_pretrained(name)


@lru_cache(maxsize=1)
def layout_model():
    import torch
    from transformers import AutoModelForTokenClassification, AutoProcessor
    name = os.getenv("LAYOUT_TOKEN_MODEL", "nielsr/layoutlmv3-finetuned-funsd")
    processor = AutoProcessor.from_pretrained(name, apply_ocr=False)
    model = AutoModelForTokenClassification.from_pretrained(name).eval()
    return model, processor


@lru_cache(maxsize=1)
def classifier_model():
    from pathlib import Path
    from transformers import AutoModelForSequenceClassification, AutoProcessor
    path = Path(os.getenv("LAYOUT_CLASSIFIER", "models/layout-classifier"))
    if not path.exists():
        return None
    return AutoModelForSequenceClassification.from_pretrained(path).eval(), AutoProcessor.from_pretrained(path, apply_ocr=False)


def pages_from_file(path, media_type=None):
    if media_type == "application/pdf" or str(path).lower().endswith(".pdf"):
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(path)
        return [page.render(scale=2).to_pil().convert("RGB") for page in pdf]
    return [Image.open(path).convert("RGB")]


def extract_ocr(image):
    result = ocr_model().predict(np.asarray(image))
    if not result:
        return []
    value = result[0].json
    value = value.get("res", value)
    words = []
    for text, score, polygon in zip(value.get("rec_texts", []), value.get("rec_scores", []),
                                    value.get("rec_polys", [])):
        points = np.asarray(polygon)
        box = [int(points[:, 0].min()), int(points[:, 1].min()),
               int(points[:, 0].max()), int(points[:, 1].max())]
        words.append({"text": str(text), "confidence": float(score), "box": box})
    return words


def _normalized_boxes(words, image):
    width, height = image.size
    return [[min(1000, max(0, round(1000 * v / (width if i % 2 == 0 else height))))
             for i, v in enumerate(word["box"])] for word in words]


def extract_layout(image, words):
    if not words:
        return {"entities": [], "fields": [], "classification": None}
    import torch
    model, processor = layout_model()
    boxes = _normalized_boxes(words, image)
    encoding = processor(image, [w["text"] for w in words], boxes=boxes,
                         truncation=True, return_tensors="pt")
    with torch.no_grad():
        logits = model(**encoding).logits.softmax(-1)
    labels = model.config.id2label
    entities = []
    seen = set()
    for token, word_index in enumerate(encoding.word_ids(batch_index=0)):
        if word_index is None or word_index in seen:
            continue
        seen.add(word_index)
        confidence, label_id = logits[0, token].max(-1)
        label = labels[int(label_id)]
        if label.lower() != "o":
            entities.append({"text": words[word_index]["text"], "label": label,
                             "box": words[word_index]["box"], "confidence": float(confidence)})
    classification = None
    trained = classifier_model()
    if trained:
        classifier, classifier_processor = trained
        inputs = classifier_processor(image, [w["text"] for w in words], boxes=boxes,
                                      truncation=True, return_tensors="pt")
        with torch.no_grad():
            probabilities = classifier(**inputs).logits.softmax(-1)[0]
        confidence, label_id = probabilities.max(-1)
        classification = {"type": classifier.config.id2label[int(label_id)],
                          "confidence": float(confidence)}
    questions = [item for item in entities if item["label"].upper().endswith("QUESTION")]
    answers = [item for item in entities if item["label"].upper().endswith("ANSWER")]
    fields = []
    for answer in answers:
        if not questions:
            break
        source = min(questions, key=lambda question:
                     abs(question["box"][1] - answer["box"][1]) * 2
                     + abs(question["box"][2] - answer["box"][0]))
        fields.append({"key": source["text"], "value": answer["text"],
                       "confidence": min(source["confidence"], answer["confidence"]),
                       "keyBox": source["box"], "valueBox": answer["box"]})
    return {"entities": entities, "fields": fields, "classification": classification}


def matric_candidates(words):
    """Conservative field candidate; the API validates school and uniqueness."""
    text = " ".join(w["text"] for w in words)
    pattern = r"(?:matric(?:ulation)?\s*(?:number|no|#)?\s*[:.]?\s*)([A-Z0-9][A-Z0-9/-]{5,24})"
    return [{"value": match.group(1).upper(), "confidence": min(
        (w["confidence"] for w in words if match.group(1).lower() in w["text"].lower()), default=0.0)}
            for match in re.finditer(pattern, text, flags=re.I)]


def dense_embedding(text):
    return text_model().encode(text or " ", normalize_embeddings=True).astype("float32")


def visual_embedding(image):
    import torch
    model, processor = visual_model()
    batch = processor.process_images([image]).to(model.device)
    with torch.no_grad():
        return model(**batch)[0].cpu().float().numpy()


def visual_query(text):
    import torch
    model, processor = visual_model()
    batch = processor.process_queries([text]).to(model.device)
    with torch.no_grad():
        return model(**batch)[0].cpu().float()


def visual_score(query, document):
    import torch
    _, processor = visual_model()
    return float(processor.score_multi_vector(query.unsqueeze(0),
                 torch.from_numpy(document).unsqueeze(0))[0, 0])
