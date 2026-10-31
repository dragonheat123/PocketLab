# Pocket Lab

A workspace for each research idea. Discover papers, retrieve source passages, use Nosana to synthesize cited ideas, design a hypothesis, and run the built-in battery benchmark in Daytona. Source evidence, inference receipts, and execution results join one Neo4j graph per workspace. Battery arbitrage is precreated from the existing battery graph.

## Project presentation

[Download the editable slides](docs/slides/pocket-lab.pptx) · [Project concept](CONCEPT.md) · [Architecture](archi.md)

The nine slides below introduce the project and its prototype vision. Some slides predate the execution integration; the working flow and implementation details below describe the current app.

![Slide 1 — Pocket Lab: a personal research workspace](docs/slides/slide-01.png)

![Slide 2 — The problem: research loses its trail across tools](docs/slides/slide-02.png)

![Slide 3 — The workflow: one workspace holds the research journey](docs/slides/slide-03.png)

![Slide 4 — Evidence: every finding keeps a path to its source](docs/slides/slide-04.png)

![Slide 5 — Technology: discovery, reasoning, and persistence](docs/slides/slide-05.png)

![Slide 6 — Example: battery arbitrage research](docs/slides/slide-06.png)

![Slide 7 — Current prototype and proposed next steps](docs/slides/slide-07.png)

![Slide 8 — Neo4j evidence database, Nosana model sandbox, and Daytona execution sandbox](docs/slides/slide-08.png)

![Slide 9 — Planned evidence-to-experiment loop](docs/slides/slide-09.png)

## The working flow

1. **Create or open a workspace.** Its research question, literature, hypotheses, experiments, and run evidence share one workspace-scoped Neo4j graph.
2. **Discover and read literature.** Search Google Scholar through SerpApi, or choose OpenAlex. Fetch accessible PDF/article text; label abstract and search-snippet fallbacks. Split readable text into bounded passages and persist `Paper` / `Chunk` evidence.
3. **Retrieve and synthesize with Nosana.** BM25 retrieves relevant passages; optional embeddings enable semantic retrieval. The backend calls the configured Nosana chat endpoint and validates the returned JSON and citation IDs. Each new call records an `InferenceRun`: actual response/request IDs when supplied, model, timestamps, token counts when returned, prompt/output hashes, and the passage IDs it used. Validated synthesis produces concepts and proposed directions; it is generated interpretation, not an experimental measurement.
4. **Design an experiment.** Review a proposed direction, choose a testable hypothesis, and optionally attach a supporting graph node. This is an explicit user step; the app does not automatically turn arbitrary model output into executable code.
5. **Execute the battery benchmark in Daytona.** Select a reviewed recipe, epoch count, and runtime image. The backend provisions a real sandbox, uploads versioned Python, captures actual command IDs and logs, checks the exit code, and validates returned metrics against the run ID and code hash. Other domains need an executable recipe before they can run.
6. **Inspect the evidence in Neo4j.** `InferenceRun` nodes connect Nosana calls to their input passages and generated outputs. `ExperimentRun` nodes connect Daytona outcomes to the experiment and hypothesis. Completed, failed, cancelled, and interrupted attempts retain their actual status. Sandbox cleanup does not remove retained run evidence.

The UI coordinates these stages through user actions. It does not yet run an autonomous, end-to-end research-to-code loop.

| Service | Current role | Evidence you can inspect |
| --- | --- | --- |
| **Nosana** | LLM inference for cited synthesis and grounded answers through an OpenAI-compatible endpoint | Purple **N** run nodes; model, provider IDs when returned, token usage, timestamps, input passages, prompt/output hashes, and validation status |
| **Daytona** | Actual sandbox execution of the built-in battery benchmark | Teal **D** run nodes; sandbox and command IDs, exit code, code hash, runtime image/device, measured metrics, and cleanup state |
| **Neo4j** | Persistent evidence and provenance graph, scoped to each workspace | Sources → passages → Nosana-generated ideas; hypotheses → experiments → Daytona results |

**Runtime image versus execution provider:** `docker.io/nosana/pytorch-jupyter:2.0.0` is a Nosana-published container that currently runs **inside Daytona on CPU**. Choosing it does not submit a Nosana GPU job. Nosana LLM inference is a separate API call. Direct Nosana GPU experiment submission and deployment orchestration are not implemented. See [Nosana inference](https://learn.nosana.com/llm/), [Nosana jobs](https://learn.nosana.com/deployments/jobs/), and [Daytona code execution](https://www.daytona.io/docs/process-code-execution).

## Run

Requires Node.js 22.16+ (tested with Node 25).

```sh
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Build with `npm run build`, serve the built application and API with `npm start`, and run backend checks with `npm test`. The server binds to localhost; it is a single-user hackathon app, not a public multi-user service.

## Workspace journey

Open **All workspaces** to create a research workspace or continue Battery arbitrage. A new workspace starts with its own question and an empty, isolated graph.

- **Overview:** the research question, real source/experiment/node counts, latest cited findings, and suggested next steps.
- **Literature:** every existing paper/document in the workspace graph, searchable by title; expand the research agent to discover more evidence and review a source collection.
- **Experiments:** design a testable hypothesis, optionally attach a supporting graph node, then run a supported battery recipe in Daytona. Follow real logs and compare measured benchmark metrics with its baseline.
- **Knowledge graph:** all sources, findings, hypotheses, experiments, and provider run evidence in that workspace. The **Proof of work** cards filter Nosana or Daytona runs and their neighbors; recent-run chips open the evidence inspector. Purple **N** rings identify Nosana inference, teal **D** rings identify Daytona execution. Inspect IDs, timestamps, hashes, status, and available usage/metrics. Experiments remain branches of the same graph.

New records carry a `workspaceId`. Graph reads and supporting-evidence selections are scoped to it. The initial migration associates unscoped existing battery data with Battery arbitrage without removing existing nodes or relationships. Workspace/experiment metadata persists in `data/workspaces/`; evidence sessions remain in `data/`. Neo4j writes are retried on server startup for locally saved workspaces and experiments. The battery runner supports real Daytona execution when DAYTONA_API_KEY is configured.

## Service connections

All credentials are loaded by the server from `.env`. Restart the server after configuration changes.

| Service | Environment variables | Behavior until connected |
| --- | --- | --- |
| Neo4j | `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, optional `NEO4J_DATABASE` | Local graph saved to `data/`; sync can be retried later |
| Nosana | `LLM_BASE_URL` (including `/v1`), optional `LLM_MODEL` and `LLM_API_KEY` | Indexed evidence and BM25 retrieval work; no generated consolidation |
| Google Scholar via SerpApi | `SERPAPI_API_KEY` | Select OpenAlex as a clearly labeled alternative |
| Optional embedding deployment | `EMBEDDING_MODEL`, optional `EMBEDDING_BASE_URL` | Uses BM25 keyword retrieval; a chat deployment need not serve embeddings |
| OpenAlex | Optional `OPENALEX_API_KEY` | Anonymous searches work subject to provider limits |
| Daytona | `DAYTONA_API_KEY`, optional `DAYTONA_API_URL` and `DAYTONA_TARGET` | Experiment design works; execution stays disabled until authenticated |

Nosana requests use `POST {LLM_BASE_URL}/chat/completions`. The backend checks `/models` and automatically selects a single served chat model when `LLM_MODEL` is blank. Set `LLM_MODEL` explicitly when multiple models are available. Initializing endpoints (HTTP 503) are shown as starting; the research workspace rechecks readiness every 15 seconds. The model must return the requested JSON structure; the server validates the structure and source passage IDs before accepting concepts or directions. No OpenAI account or API key is needed. A separate embedding model is optional; point `EMBEDDING_BASE_URL` to a deployment that supports `/embeddings` if desired.

After connecting Nosana, open the workspace’s Literature section, expand its research notebook, and choose **Generate with Nosana**. Successful consolidation and its inference receipt are written back into the workspace graph automatically. Grounded-answer calls also retain receipts. No need to repeat paper discovery. Older synthesis made before receipt capture has no invented request ID or run timestamp; generate a new synthesis to produce a complete receipt.

## API endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Search configuration and live Nosana, Neo4j, and Daytona connectivity |
| `GET /api/workspaces` | List workspaces with graph counts, experiments, and execution summaries |
| `POST /api/workspaces` | Create a workspace with `{ "name": "…", "idea": "…", "domain": "…" }` |
| `GET /api/workspaces/:id` | Workspace details and statistics |
| `POST /api/workspaces/:id/experiments` | Add a planned experiment with `{ "name": "…", "hypothesis": "…", "sourceNodeId": "optional Neo4j element ID" }` |
| `POST /api/workspaces/:id/sync` | Retry workspace and experiment graph writes |
| `GET /api/graph?workspaceId=:id` | Read the workspace graph (up to 500 nodes and 1,500 relationships; defaults to Battery arbitrage) |
| `POST /api/research` | Start discovery with `{ "idea": "your research idea", "provider": "scholar", "limit": 6, "workspaceId": "battery-arbitrage" }` (`openalex` is also supported) |
| `GET /api/research?workspaceId=:id` | List evidence sessions for a workspace |
| `GET /api/research/:id` | Research status, activity, papers, evidence, synthesis, and graph |
| `POST /api/research/:id/consolidate` | Generate or regenerate cited concepts through Nosana |
| `POST /api/research/:id/sync` | **Neo4j write endpoint**: atomically persist the research graph using configured database credentials |
| `POST /api/research/:id/ask` | Retrieve evidence and optionally generate a grounded answer with `{ "question": "..." }` |

## Showing real sandbox execution

Open **Experiments → an experiment → Run in Daytona**. The execution panel shows actual lifecycle transitions, stdout/stderr snapshots, the sandbox ID, session command IDs, exit codes, wall-clock duration, uploaded Python SHA-256, and validated returned metrics. Closing the panel leaves the remote run active; reopening restores its current state. Stop run requests cancellation and sandbox deletion.

The initial executable recipe is **Battery arbitrage benchmark v1**. Choose a fixed-penalty baseline, adaptive penalty, degradation penalty, or cosine learning-rate variant. Both baseline and variant use the same fixed illustrative 24-hour price profile and physical schedule projection. These metrics describe the benchmark, not a market backtest or automatic proof of an arbitrary hypothesis. Other workspaces need an executable recipe before they can run.

Runtime choices are **Daytona Python** and the supplied **docker.io/nosana/pytorch-jupyter:2.0.0** image, pinned to digest `sha256:6e5c66c0bbe6cd1add87bac0bb4a5b64feee3bf13766dca949d137d32376065c`. The latter is a Nosana-published container running inside a Daytona sandbox; it does not create a Nosana GPU deployment. The first image snapshot may take several minutes. The benchmark explicitly executes on CPU, and remote PyTorch/Python versions and CUDA availability are included in new run results.

Sandboxes are ephemeral, auto-stop after five idle minutes, and have a ten-minute maximum lifetime. The worker deletes them after collection or failure and retains run evidence locally and in Neo4j. Run creation and source preparation are bounded; duplicate concurrent runs in one workspace are rejected. Interrupted runs are marked honestly on restart. No service API keys are forwarded into experiment environments.

Execution API routes use the prefix `/api/workspaces/:workspaceId/experiments/:experimentId/runs`:

- `POST /` starts a run with `{ "variant": "adaptive", "epochs": 1000, "runtime": "daytona-python" }` (runtime may also be `nosana-pytorch`).
- `GET /:runId` returns actual run state, commands, logs, metrics, and provenance.
- `GET /:runId/code` returns the uploaded Python for inspection.
- `POST /:runId/cancel` requests cancellation and cleanup.

Terminal attempts are recorded as `(Experiment)-[:EVALUATED_BY]->(ExperimentRun)` and `(Hypothesis)-[:EVALUATED_BY]->(ExperimentRun)` in the same workspace graph.

## Showing provider evidence during a demo

- **In Pocket Lab:** open **Battery arbitrage → Knowledge graph**. Select the Nosana or Daytona **Proof of work** card, then select a run chip or an N/D node. Follow `USED_EVIDENCE`, `GENERATED`, and `EVALUATED_BY` connections. The inspector distinguishes generated interpretation, completed measurement, failed execution, and provisioning-only attempts.
- **In Daytona:** start a run from **Experiments** and open the [Daytona dashboard](https://app.daytona.io) while it runs. Match the sandbox ID displayed in Pocket Lab. The worker deletes the sandbox after collection; Pocket Lab retains its logs and provenance.
- **For Nosana inference:** [Nosana's usage endpoint](https://learn.nosana.com/llm/#usage-and-cost), `GET https://api.nosana.com/credits/llm/usage?limit=20`, returns provider-recorded inference history with request IDs, model, tokens, timestamp, and cost. Authenticate server-side with the Nosana API key. This is inference usage, not a separately submitted GPU experiment. Pocket Lab records receipts from each new response; it does not currently import account-wide billing history.

## Evidence and graph model

The discovery worker deduplicates papers, fetches publicly accessible PDFs/article bodies, and labels abstract or Scholar snippet fallbacks explicitly. It never bypasses paywalls. Downloads are limited to 8 MB with timeouts and public-address checks, including redirects. PDF extraction reads at most 30 pages. Text is split into 1,600-character passages with 200-character overlap, capped at 24 passages per paper; this is a bounded evidence sample, not an exhaustive literature review. Scanned PDFs need a future OCR integration.

Documents with no readable evidence remain listed as metadata only. Empty searches, provider failures, interrupted jobs, inaccessible full text, and malformed or uncited model outputs produce visible errors or explicit partial results. Source-backed does not imply verified scientific truth: generated claims still require review.

The document pipeline persists its extracted evidence into Neo4j: **public document download → PDF/HTML extraction → bounded passages → `Paper` and `Chunk` nodes**. Each `Chunk` stores passage text and its offset and links to its source through `HAS_CHUNK`. Raw PDF/HTML files are not archived in Neo4j. Graph writes occur after retrieval and optional synthesis when Neo4j is configured; failed writes retain local session data for retry. Retrieval currently uses the session passages in memory. See [document ingestion architecture](archi.md#document-ingestion-into-neo4j).

Neo4j stores:

```text
(ResearchTopic)-[:EXPLORES]->(Paper)-[:HAS_CHUNK]->(Chunk)
(ResearchTopic)-[:CONSOLIDATES]->(Concept)-[:GROUNDED_IN]->(Chunk)
(Paper)-[:SUPPORTS]->(Concept)
(ResearchTopic)-[:SUGGESTS]->(ResearchDirection)-[:GROUNDED_IN]->(Chunk)
(Paper)-[:INFORMS]->(ResearchDirection)
(ResearchTopic {kind: "workspace"})-[:HAS_RESEARCH]->(ResearchTopic)
(ResearchTopic {kind: "workspace"})-[:HAS_EXPERIMENT]->(Experiment)-[:TESTS]->(Hypothesis)
(Hypothesis)-[:GROUNDED_IN]->(source node in the same workspace)
(ResearchTopic)-[:HAS_INFERENCE_RUN]->(InferenceRun {provider: "Nosana"})
(InferenceRun)-[:USED_EVIDENCE]->(Chunk)
(InferenceRun)-[:GENERATED]->(Concept or ResearchDirection)
(Experiment)-[:EVALUATED_BY]->(ExperimentRun {provider: "Daytona"})
(Hypothesis)-[:EVALUATED_BY]->(ExperimentRun)
```

Writes use parameterized Cypher, a unique ID constraint, and a transaction. Re-syncing retains paper/chunk identities and run IDs. New synthesis outputs use the inference run ID; outputs already linked to a recorded run are retained so later synthesis does not overwrite their provenance. Grounded-answer receipts retain the validated output snapshot on the run; consolidation additionally links its concept/direction nodes through `GENERATED`. Paper metadata, evidence, vectors (when configured), synthesis, and session state also persist locally under ignored `data/`. The frontend never receives credentials or embedding vectors. Research session graph previews show the graph payload written by sync. The workspace **Knowledge graph** view reads only that workspace’s graph directly from Neo4j, including the imported battery data. It supports searching, filtering, zooming, panning, and inspecting relationships. Viewing the graph never changes database contents.

## Provider documentation

- [SerpApi Google Scholar](https://serpapi.com/google-scholar-api)
- [OpenAlex API](https://help.openalex.org/api/)
- [Nosana LLM inference](https://learn.nosana.com/llm/)
- [Neo4j JavaScript driver](https://neo4j.com/docs/javascript-manual/current/query-simple/)
