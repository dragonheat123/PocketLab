# Pocket Lab — Project Concept

> A personal research lab where a question becomes a source library, a testable hypothesis, and a connected body of knowledge.

## Vision

Pocket Lab helps people turn an interesting idea into structured, evidence-backed research. Each idea gets a dedicated workspace that keeps its question, literature, findings, hypotheses, and experiments connected in one knowledge graph.

The long-term ambition is a continuous research loop: discover evidence, understand it, propose a test, run it, and use the results to refine the next question. The current prototype supports discovery, grounded synthesis, graph exploration, and experiment planning; automated experiment execution is a future capability.

## The problem

Research often spreads across browser tabs, saved papers, notes, model conversations, and code. As the work grows, it becomes difficult to explain where a claim came from, why an experiment was proposed, or how a new result changes the original idea.

Pocket Lab brings these relationships into a persistent workspace so a researcher can follow the path from question to evidence to hypothesis.

## Who it is for

- Independent researchers and students exploring a new topic.
- Engineers investigating technical ideas through literature and experiments.
- Builders developing a proof of concept and documenting the reasoning behind it.

The current application is a local, single-user hackathon prototype. Team collaboration and public hosting would require additional product and security work.

## Core experience

1. **Start with a question.** Create a workspace with a name, research idea, and domain.
2. **Build an evidence library.** Discover papers through Google Scholar via SerpApi or OpenAlex. Download accessible documents, extract PDF/HTML text, and split it into bounded evidence passages. Persist source metadata and passage text in Neo4j as linked `Paper` and `Chunk` nodes when graph sync succeeds, retaining clear labels when only abstracts or snippets are available.
3. **Develop an understanding.** Retrieve relevant passages, ask questions, and use a configured Nosana model to generate concepts and research directions grounded in source passages.
4. **Form a testable hypothesis.** Save a planned experiment and optionally connect it to supporting evidence in the workspace graph.
5. **Explore the research story.** Navigate relationships among sources, passages, concepts, hypotheses, and experiments to understand how the work fits together.
6. **Continue the loop.** Use the accumulated evidence to refine the question and plan the next experiment. Execution and result ingestion belong to the proposed next phase.

## Product structure

| Area | Purpose |
| --- | --- |
| All workspaces | Create or return to an independent research idea. |
| Overview | Review the question, available findings, activity counts, and next steps. |
| Literature | Discover sources, inspect evidence, and generate a cited synthesis. |
| Experiments | Capture hypotheses and supporting evidence as planned experiments. |
| Knowledge graph | Explore the connected research record within the selected workspace. |

Each workspace has a logically isolated graph within the shared Neo4j database. Experiments extend the same workspace graph, preserving their relationship to the research that motivated them.

## What makes the concept useful

- **An idea is the organizing unit.** Sources and experiments remain attached to the question they serve.
- **Claims have a visible evidence trail.** Generated concepts and directions must reference accepted source passage IDs; researchers still review their scientific validity.
- **The graph preserves reasoning.** Relationships help users move from a finding back to a source or forward to a proposed test.
- **Partial progress remains useful.** Local persistence and keyword retrieval support work when optional services are unavailable, with connection and sync status exposed to the user.
- **Uncertainty stays visible.** Missing full text, failed searches, incomplete ingestion, and unavailable model services are surfaced explicitly.

## Technology roles

| Layer | Role |
| --- | --- |
| Browser interface | Workspace navigation, evidence review, experiment planning, and interactive graph exploration. |
| Node.js / Express | Research jobs, service integrations, validation, persistence, and API endpoints. |
| Neo4j | Evidence database linking literature, claims, hypotheses, and experiments, with run and result provenance planned. |
| Nosana | Model / GPU sandbox for cited synthesis and future model trials. Chat inference exists; trial orchestration is planned. |
| SerpApi / OpenAlex | Scholarly discovery and source metadata. |
| Local storage | Persist research sessions and workspace metadata, including data awaiting graph synchronization. |
| Optional embedding service | Semantic retrieval when configured; BM25 keyword retrieval is the fallback. |
| Daytona — planned | Code-execution sandbox for reproducible tests, simulations, logs, and artifacts; currently unconnected. |

## Evidence database and research sandboxes

The planned research loop gives each service a distinct role:

| Service | How Pocket Lab will use it | Current status |
| --- | --- | --- |
| **Neo4j: evidence database** | Keep papers, source passages, claims, hypotheses, and experiments connected by provenance. Extend the graph with execution runs, measured results, and artifact references so every conclusion can be traced to literature or a recorded test. | Evidence and planned-experiment graph integration exists. Run and result records are planned. |
| **Nosana: model / GPU sandbox** | Use configurable model deployments to synthesize evidence and propose hypotheses. Record the model, prompt configuration, input evidence IDs, and output for each future model trial so different reasoning approaches can be compared. | Configurable chat inference exists. Per-trial deployment orchestration and model-run provenance are planned. |
| **Daytona: code-execution sandbox** | Create a dedicated environment for an experiment, load its code and selected inputs, run simulations or tests, and collect exit status, logs, metrics, and output artifacts. | Planned. The current app saves experiments without executing them. |

Here, “Nosana sandbox” describes the model and GPU experimentation role. Nosana runs container-defined GPU jobs and deployments, while Daytona provides the programmatic code sandbox. The app will coordinate these as separate execution layers. See [Nosana jobs](https://learn.nosana.com/deployments/jobs/) and [Daytona code execution](https://www.daytona.io/docs/process-code-execution).

A future run will retrieve a scoped evidence bundle, ask Nosana for a cited proposal, execute the test in Daytona, and write validated results back through the backend into Neo4j. Generated proposals remain separate from measured outcomes. Local files continue to support unsynchronized work.

## Current prototype boundaries

The application supports multiple research workspaces, scholarly discovery, bounded ingestion of accessible documents, passage retrieval, optional model synthesis, graph synchronization, and planned experiments. Battery arbitrage is the precreated example workspace, using the existing battery research graph.

Ingestion is a bounded evidence sample rather than an exhaustive literature review. It does not bypass paywalls, and scanned PDFs need a future OCR integration. Sources without readable text remain metadata only. Experiment records do not represent completed runs, and the application does not fabricate execution metrics.

## Example: battery arbitrage

**Question:** How can a battery optimize a 24-hour trading schedule while respecting state-of-charge, power, efficiency, and degradation constraints?

A researcher discovers relevant literature, inspects accessible passages, and consolidates concepts about optimization and physical constraints. They then record a hypothesis about an alternative constraint-handling method and connect it to supporting evidence. The graph preserves that chain of reasoning for review and a future executable experiment.

Any improvement in profit, feasibility, or degradation remains a hypothesis until an actual experiment produces results.

## Proposed next steps

1. Connect an experiment executor and capture run configuration, logs, artifacts, and failures.
2. Attach measured outcomes to experiments and compare results against their hypotheses.
3. Strengthen evidence coverage with OCR, broader document support, and clearer ingestion diagnostics.
4. Add richer research review tools for conflicting findings and changes across iterations.
5. Explore collaboration once identity, permissions, and deployment requirements are defined.

These are product directions, not shipped capabilities or committed milestones.

## Success criteria

The concept succeeds when a researcher can start with a question, collect inspectable evidence, formulate a testable hypothesis, and explain the connections without reconstructing the process from scattered notes. A future execution phase should complete that record with reproducible runs and measured outcomes.

For setup, API details, and operational limits, see [README.md](README.md).
