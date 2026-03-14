# @affectively/capacitor

`@affectively/capacitor` is a collaborative editor and document platform with CRDT-backed documents, structured semantic layers, multiple reading and publishing projections, and built-in collaboration features.

The strongest fair brag is breadth. This repo already covers much more than a text box: editor UI, document model, revisions, code-aware blocks, comments, presence, publishing, provenance, analytics, search, and alternative projections such as audio and spatial views.

## What It Tries To Make Easier

- keep a collaborative document in sync,
- preserve more structure than plain text,
- switch between writing, reading, and publishing views without throwing the document away,
- and layer in comments, presence, provenance, and search without bolting them on later.

The "embedding-first" idea in this repo is best read as: the document can carry semantic structure as a first-class part of the model, not only as text on a page.

## Why People May Like It

- the package already exports a broad editor stack instead of only one widget,
- collaboration is built in with CRDT documents, comments, and presence,
- projections are a real part of the model, with text, reading, audio, and spatial surfaces,
- publishing and provenance live close to authoring instead of in separate systems,
- and the repo is large enough to feel substantial, with a broad export surface and dedicated tests.

## Main Areas

- `core`: embedding and indexing primitives
- `document`: CRDT document model and document addressing
- `revisions`: revision management
- `editor`: editor UI, block rendering, command palette, and suggestions
- `code`: code-aware runtime and imagined execution helpers
- `collaboration`: presence and inline comments
- `projections`: reading, audio, spatial, squared-square, and hypercube views
- `publishing`: publish records and export pipeline
- `intelligence`: backlinks, search, document profiling, and reader/writer analysis
- `provenance`: authorship and contribution tracking
- `analytics`: reading analytics
- `sharing`: capability sharing
- `voice`: voice model and voice interface
- `layout`: layout and content selection helpers
- `container`: higher-level document wrapper

That is the real story here. Capacitor is not a minimal editor package. It is a broad document system.

## Quick Start

```ts
import {
  AeonDocument,
  EditorRoot,
  CollaborationPresence,
  CommentManager,
  DocumentSearch,
  PublishingPipeline,
} from '@affectively/capacitor';
```

## What You Get

- a CRDT-backed document surface,
- editor UI primitives,
- revision handling,
- code-aware blocks,
- multiple output projections,
- collaboration presence and comments,
- publishing helpers,
- provenance tracking,
- search and document intelligence helpers.

## Why This README Is Grounded

Capacitor does not need to promise a new theory of writing. The strongest fair brag is that it already looks like a serious editor platform with collaboration, semantic structure, multiple projections, and a wide export surface in one package.
