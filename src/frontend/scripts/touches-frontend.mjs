#!/usr/bin/env node
/**
 * Reads changed file paths (one per line, repo-relative) on stdin and prints
 * `frontend=true` when any is frontend source or a built bundle file, else
 * `frontend=false`. CI appends the line to $GITHUB_OUTPUT to decide whether
 * a pull request must pass `npm run check:bundle`.
 *
 *   git diff --name-only HEAD^1 HEAD | node src/frontend/scripts/touches-frontend.mjs
 */
import { readFileSync } from 'node:fs'
import { isFrontendPath } from './lib/bundle-files.mjs'

const files = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const hits = files.filter(isFrontendPath)
for (const f of hits.slice(0, 20)) console.error(`frontend: ${f}`)
console.log(`frontend=${hits.length > 0}`)
