# DevOps Pulse

Real-Time DevOps CI/CD Pipeline & Codebase Auditor

DevOps Pulse is an automated repository auditor and CI/CD readiness evaluation tool designed to run at the root of any application directory. It provides static directory analysis, security secret detection, dependency manifest evaluation, CI/CD workflow verification, and automated generation of missing DevOps infrastructure blueprints.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Methodology & Scoring Engine](#methodology--scoring-engine)
- [Workflow](#workflow)
- [Tech Stack](#tech-stack)
- [Installation & Setup](#installation--setup)
- [Usage & CLI Reference](#usage--cli-reference)
- [Generated Artifacts](#generated-artifacts)
- [License](#license)

---

## Overview

Modern software development requires deterministic build pipelines, container specifications, security secret hygiene, and consistent repository governance. DevOps Pulse addresses these necessities by executing multi-faceted static checks directly from the command line or via an interactive Web dashboard interface.

---

## Architecture

The system is structured as a modular Node.js application comprising four distinct subsystems: Analyzers, Core Engine, Blueprint Generators, and User Interfaces (CLI and Web UI).

```
DevOps Pulse Application Architecture
├── bin/
│   └── cli.js                  Entry point for CLI execution and argument parsing
├── lib/
│   ├── analyzers/
│   │   ├── structureScanner.js  Directory tree traversing & tech stack detection
│   │   ├── dependencyAuditor.js Manifest verification (package.json, requirements.txt)
│   │   ├── securityScanner.js   Static code secret leak detection & env checking
│   │   └── cicdChecker.js       CI/CD workflow & Docker configuration verification
│   ├── engine/
│   │   └── devopsAdvisor.js     Aggregator & scoring engine
│   ├── generators/
│   │   └── fixTemplates.js      Automated blueprint file generators
│   └── web/
│       ├── server.js            Express REST API server
│       └── public/              Static web dashboard assets (HTML, CSS, JS)
├── package.json
└── LICENSE
```

---

## Methodology & Scoring Engine

The scoring system calculates a CI/CD Readiness Score ranging from 0 to 100 based on findings categorized by severity:

| Severity Level | Score Impact per Finding | Description |
| :--- | :--- | :--- |
| **CRITICAL** | -20 Points | Absence of CI/CD workflows, uncommitted secrets, missing `.gitignore`, or invalid configuration files. |
| **WARNING** | -10 Points | Missing lockfiles, unpinned dependency wildcards, missing `.env.example`, or absent unit test scripts. |
| **INFO** | -3 Points | Absence of linter configurations, minor documentation gaps, or missing secondary build scripts. |
| **PASS** | 0 Points | Verification of standard DevOps patterns and compliance benchmarks. |

### Health Status Matrix

- **90 - 100% (Grade A+)**: Production Ready Pipeline
- **75 - 89% (Grade B)**: Good - Minor Improvements Recommended
- **60 - 74% (Grade C)**: Moderate - Missing Key Automation & Security Controls
- **40 - 59% (Grade D)**: Poor - Significant DevOps Gaps
- **0 - 39% (Grade F)**: High Risk - Immediate Action Required

---

## Workflow

1. **Invocation**: Executed from the terminal root using `devops-pulse`.
2. **Directory Traversal**: Scans files while adhering to `.gitignore` exclusions and system boundaries.
3. **Multi-Module Audit**:
   - `structureScanner`: Identifies directory layout and programming language ecosystem.
   - `dependencyAuditor`: Verifies lockfile integrity and package management scripts.
   - `securityScanner`: Performs regex pattern matching for API keys, SSH keys, AWS credentials, and `.env` handling.
   - `cicdChecker`: Checks presence of `.github/workflows/`, `Dockerfile`, `.dockerignore`, and documentation.
4. **Aggregation & Reporting**: Computes the score, outputs results to the CLI, or serves the real-time Web Dashboard.
5. **Remediation**: Generates tailored configuration files upon user request via CLI (`--fix`) or Web UI buttons.

---

## Tech Stack

- **Runtime**: Node.js (v18.0.0+)
- **CLI Framework**: Commander.js
- **Terminal Formatting**: Picocolors
- **Web Server**: Express.js
- **Web Interface**: Standard HTML5, Modern CSS3 (CSS Variables, Flexbox, CSS Grid), Vanilla ES6 JavaScript
- **Browser Integration**: Open

---

## Installation & Setup

### Prerequisites
- **Node.js**: Version 18.0.0 or higher is required.

### Local Installation & Dependency Sync
To set up dependencies and link the package:
```bash
# Install package dependencies and update lockfile
npm install

# Link package globally (optional)
npm link
```

### Running Modes Reference

#### 1. CLI Terminal Mode (Full Output)
Run the auditor scan and view detailed colorized recommendations and grade breakdown directly in your terminal:
```bash
# If globally linked:
devops-pulse

# Alternatively, from project root:
npm start
# or:
node bin/cli.js
```

#### 2. Quiet CI Pipeline Check (`-c` / `--check`)
Executes a quiet check suitable for CI pipelines, returning exit status code `0` if DevOps readiness is acceptable (Grade A+ or B, score >= 75%), and exit code `1` if unacceptable:
```bash
devops-pulse --check
# or:
node bin/cli.js --check
```

#### 3. Interactive Web Dashboard (`-w` / `--web`)
Serves and launches the modern glassmorphism dark-mode dashboard in your browser:
```bash
npm run web
# or:
node bin/cli.js --web
```
*Accessible on `http://localhost:3850`.*

#### 4. Auto-Fix Mode (`-f` / `--fix`)
Interactively apply recommended templates (GitHub Actions pipeline config, docker configs, `.gitignore`, `.env.example`) to the target stack:
```bash
devops-pulse --fix
# or:
node bin/cli.js --fix
```

#### 5. Dockerized Execution
To build and execute the tool and dashboard inside a containerized Docker runtime:
```bash
# Build the image
docker build -t devops-pulse .

# Run the container (binds web dashboard to port 3850)
docker run -d -p 3850:3850 devops-pulse
```

---

## Usage & CLI Reference

### Command Syntax

```bash
devops-pulse [options]
```

### Options

| Flag | Long Option | Description |
| :--- | :--- | :--- |
| `-w` | `--web` | Launches the interactive Web UI Dashboard in your default browser. |
| `-f` | `--fix` | Prompts to auto-generate missing recommended DevOps files. |
| `-c` | `--check` | Runs a quiet audit for CI pipelines, returning exit code 0 if grade is A or B (score >= 75%), and 1 otherwise. |
| `-j` | `--json` | Outputs audit results in JSON format for automated pipelines. |
| `-d` | `--dir <path>` | Audits a specified target directory instead of the current working directory. |

---

## Generated Artifacts

When auto-remediation is requested, DevOps Pulse produces production-ready configurations tailored to your stack:

- `.github/workflows/ci.yml`: Standard continuous integration workflow.
- `Dockerfile`: Multi-stage container definition optimized for minimal footprint.
- `.dockerignore`: Exclusion list for Docker context transfers.
- `.gitignore`: Language-specific ignored file definitions.
- `.env.example`: Safe blueprint template for environment variables.

---

## License

Copyright 2026

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
