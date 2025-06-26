# School Keep

School Keep has a NestJS API (`server`), a Next.js admin app (`web`), a Flutter student app (`app`), and a local Python document research service (`ml`). MongoDB remains the application database. New scans are processed in the background with PaddleOCR, LayoutLMv3, Sentence-BERT/FAISS, and ColPali. Model weights, indexed pages, uploaded files, and evaluation data stay outside Git.

## Local setup without Docker

Prerequisites: Node.js 20, Flutter with Dart 3.5 or newer, MongoDB, Python 3.11 or 3.12, and enough disk space for model weights. The first ML request downloads models. ColPali is large and runs best with Apple Silicon MPS or a CUDA GPU; CPU works more slowly.

```bash
cp server/.env.example server/.env
cp web/.env.local.example web/.env.local
cd server && npm ci && cd ..
cd web && npm ci && cd ..
cd ml && uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python -e '.[test]' && cd ..
cd app && flutter pub get && cd ..
mkdir -p .local-mongo
```

Set a private `JWT_SECRET` and `SCHOOL_MANAGERS_PASSWORD` in `server/.env`. `MAILER_MODE=log` prints local email events without sending them. Cloudinary is optional; `STORAGE_DRIVER=local` stores uploads under `server/storage`. To use Cloudinary, set `STORAGE_DRIVER=cloudinary` and its three credentials.

Start MongoDB in one terminal with `mongod --dbpath .local-mongo --bind_ip 127.0.0.1 --port 27017`. Start the apps in another terminal with `bash scripts/dev.sh`. The admin site is at `http://localhost:3000`, the API at `http://localhost:4000/api/v1`, and the Python service at `http://127.0.0.1:8001`. The API seeds school managers using the configured local password.

For Flutter on a simulator, run `flutter run --dart-define=API_URL=http://localhost:4000/api/v1` from `app`. For the Android emulator, use `http://10.0.2.2:4000/api/v1`. A physical device needs your computer's LAN address in both `API_URL` and `PUBLIC_API_URL`.

## Document workflow

Admins can import multiple PDF, PNG, JPEG, or TIFF scans from **Documents → Import and review**. Uploaded and existing documents can be queued for processing there. The worker saves OCR text and coordinates, LayoutLMv3 output, a conservative student match, and search indexes per document version. Automatic linking requires a high-confidence matriculation number that uniquely matches a student in the same school. Ambiguous records enter the review queue. Clearance approval remains an admin decision.

School document types are configurable. A school-specific LayoutLMv3 classifier needs reviewed examples: export `GET /api/v1/document/training-export` using an admin session to a JSON file, then run `cd ml && .venv/bin/python -m scripts.train_classifier data/training-export.json`. At least two labeled examples of each of two types are required. Restart the Python service to load the new checkpoint. Until then, generic FUNSD field extraction runs and type decisions go to review.

Search modes are keyword, semantic (Sentence-BERT with FAISS), visual (ColPali), and hybrid reciprocal rank fusion. Search results are restricted to documents the requester may access. The Python index is durable in `ml/indexes/pages.sqlite`; deleted documents are removed from it.

## Evaluation

From `ml`, run:

```bash
.venv/bin/python -m scripts.benchmark_vidore --samples 50
.venv/bin/python -m scripts.eval_academic_forms
.venv/bin/streamlit run dashboard.py
```

The retrieval benchmark uses [ViDoRe ArxivQA](https://huggingface.co/datasets/vidore/arxivqa_test_subsampled) under CC BY-SA 4.0. The academic forms runner downloads public blank forms from [Bowen University](https://bowen.edu.ng/wp-content/uploads/2020/04/transcript-request-form.pdf), [University of Port Harcourt](https://www.uniport.edu.ng/wp-content/uploads/2024/11/APPLICATION_FORMAT.pdf), [Yusuf Maitama Sule University](https://nwu.edu.ng/wordpress/wp-content/uploads/2021/12/NYSC-CLEARANCE-FORM.pdf), and [Ahmadu Bello University](https://abu.edu.ng/wp-content/uploads/2023/09/Exit-Clearence-Form.pdf). It compares OCR with embedded PDF text, an approximate reference, and uses explicitly synthetic identities for record matching. Downloads are local and are not committed.

For manually annotated form evaluation, first read the [FUNSD research-use terms](https://guillaumejaume.github.io/FUNSD/work/) and download the dataset yourself. Run `.venv/bin/python -m scripts.eval_funsd path/to/dataset` from `ml`. The Streamlit dashboard reads JSON results in `ml/results`; it does not generate metrics on its own. No new usability study is conducted. The thesis's reported 88.73% usability figure has not been reproduced by this code.

## Checks

Run `npm run build` in `server`, `npx tsc --noEmit` in `web`, `flutter analyze` in `app`, and `.venv/bin/python -m pytest` in `ml`. A successful build does not prove model quality; use the evaluation runners and review their saved results.
