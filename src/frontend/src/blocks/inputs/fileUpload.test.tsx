import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { collectFormValues } from '../formState'
import { FileUploadInput } from './FileUploadInput'
import { formatFileSize, inferUploadMimeType, parseInitialFiles, parseUploadResponse, validateUploadCandidate } from './fileUploadModel'

test('fileUploadModel formats sizes, infers MIME types, validates limits, and parses handles safely', () => {
  assert.equal(formatFileSize(512), '512 B')
  assert.equal(formatFileSize(2048), '2.0 KB')
  assert.equal(formatFileSize(3 * 1024 * 1024), '3.0 MB')
  assert.equal(inferUploadMimeType({ name: 'notes.md', type: '' }), 'text/markdown')
  assert.equal(inferUploadMimeType({ name: 'notes.md', type: 'text/x-markdown' }), 'text/markdown')
  assert.equal(inferUploadMimeType({ name: 'data.csv', type: '' }), 'text/csv')
  assert.equal(inferUploadMimeType({ name: 'data.csv', type: 'application/vnd.ms-excel' }), 'text/csv')
  assert.equal(inferUploadMimeType({ name: 'x.bin', type: 'application/pdf' }), 'application/pdf')

  assert.equal(validateUploadCandidate({ name: 'a.csv', size: 1024 }, 5), null)
  assert.match(validateUploadCandidate({ name: 'big.pdf', size: 6 * 1024 * 1024 }, 5) ?? '', /exceeds the 5 MB limit/)

  assert.deepEqual(
    parseUploadResponse(
      { id: 'abc-123', filename: 'report.pdf', content_type: 'application/pdf', size: 4200, path: '/tmp/secret' },
      'fallback.pdf',
    ),
    { id: 'abc-123', filename: 'report.pdf', content_type: 'application/pdf', size: 4200 },
  )
  assert.equal(parseUploadResponse({ filename: 'missing-id.txt' }, 'x'), null)
  assert.deepEqual(
    parseInitialFiles({ id: 'u1', filename: 'sales.csv', content_type: 'text/csv', size: 42 }, false),
    [{ id: 'u1', filename: 'sales.csv', content_type: 'text/csv', size: 42 }],
  )
})

test('collectFormValues skips native file inputs and reads JSON HiddenValue handles', () => {
  const fakeFileInput = {
    type: 'file',
    name: 'files',
    value: 'C:\\fakepath\\secret.pdf',
    dataset: {},
    getAttribute: () => null,
  }
  const fakeHiddenInput = {
    type: 'hidden',
    name: 'files',
    value: JSON.stringify({ id: 'u1', filename: 'secret.pdf', content_type: 'application/pdf', size: 12 }),
    dataset: { aiuiJson: '' },
    getAttribute: () => null,
  }
  const fakeForm = {
    querySelectorAll: () => [fakeFileInput, fakeHiddenInput],
  } as unknown as HTMLFormElement

  assert.deepEqual(collectFormValues(fakeForm), {
    files: { id: 'u1', filename: 'secret.pdf', content_type: 'application/pdf', size: 12 },
  })
})

test('FileUploadInput renders accessible dropzone and JSON hidden field', () => {
  const html = renderToStaticMarkup(
    createElement(FileUploadInput, {
      node: {
        type: 'file_upload',
        props: {
          label: 'Upload PDF',
          name: 'doc',
          accept: '.pdf,.csv',
          max_size_mb: 5,
          help_text: 'Drop PDF or CSV here',
        },
      },
    }),
  )
  assert.match(html, /Upload PDF/)
  assert.match(html, /Drop PDF or CSV here/)
  assert.match(html, /accept="\.pdf,\.csv"/)
  assert.match(html, /name="doc"/)
  assert.match(html, /data-aiui-json=""/)
})

test('FileUploadInput renders hydrated initial file chips from node.props.value', () => {
  const html = renderToStaticMarkup(
    createElement(FileUploadInput, {
      node: {
        type: 'file_upload',
        props: {
          label: 'Upload CSV',
          name: 'doc',
          value: { id: 'u1', filename: 'sales.csv', content_type: 'text/csv', size: 2048 },
        },
      },
    }),
  )
  assert.match(html, /sales\.csv/)
  assert.match(html, /2\.0 KB/)
  assert.match(html, /Remove sales\.csv/)
})
