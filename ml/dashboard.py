"""Run with: streamlit run dashboard.py"""

import json
from pathlib import Path

import pandas as pd
import streamlit as st

st.set_page_config(page_title="School Keep research evaluation", layout="wide")
st.title("Document processing and retrieval evaluation")
st.caption("Results are produced by benchmark scripts. Synthetic record matching is labeled separately.")

files = sorted(Path("results").glob("*.json"), reverse=True)
if not files:
    st.info("No evaluation runs yet. Run scripts/benchmark_vidore.py or scripts/eval_academic_forms.py.")
    st.stop()

selected = st.selectbox("Evaluation run", files, format_func=lambda path: path.name)
report = json.loads(selected.read_text())
st.write("Dataset:", report.get("dataset", "unknown"))
st.write("Model versions:", report.get("models", {}))
st.write("Sample size:", report.get("sample_size", "unknown"))

if "retrieval" in report:
    st.subheader("Retrieval")
    frame = pd.DataFrame(report["retrieval"]).T
    st.dataframe(frame.style.format("{:.3f}"), use_container_width=True)
    st.bar_chart(frame[[column for column in frame.columns if column.startswith("recall")]])

if "ocr" in report:
    st.subheader("OCR")
    st.dataframe(pd.DataFrame(report["ocr"]), use_container_width=True)

if "extraction" in report:
    st.subheader("Field extraction and classification")
    st.json(report["extraction"])

if "matching" in report:
    st.subheader("Student record matching")
    st.warning("Matching examples use synthetic identities on academic form layouts.")
    st.json(report["matching"])

st.subheader("Method")
st.write(report.get("method", "See the benchmark script for details."))
