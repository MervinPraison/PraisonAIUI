// API reference tags (docs/ApiFields.tsx, docs/panels.ts) through the real docs pipeline:
// preprocessing, the sanitizer allowlist and the components.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'
import { splitPanels } from './panels'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'
import { DOCS_ALLOWED_ELEMENTS } from '../markdown/docsTags'

const render = (md: string) => renderToStaticMarkup(
    <Markdown variant="docs" components={DOCS_TAG_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{md}</Markdown>,
)
const renderDocs = (md: string) => render(preprocessMkdocsMarkdown(md))

test('ParamField: name, type, location, required, deprecated, default, pre/post pills and an anchor', () => {
    const html = renderDocs([
        '<ParamField path="user_id" type="string" required>The **user** to fetch.</ParamField>',
        '<ParamField query="tags" type="string[]" deprecated default="all" placeholder="red" pre={["beta"]} post={["v2", "internal"]}>',
        'Filter by tag.',
        '</ParamField>',
    ].join('\n'))
    assert.match(html, /<div class="aiui-field" id="param-user_id" data-at="path"><div class="aiui-field-head"><a class="aiui-field-name" href="#param-user_id">user_id<\/a><span class="aiui-field-type">string<\/span><span class="aiui-field-pill">path<\/span><span class="aiui-field-pill" data-tone="required">required<\/span><\/div>/)
    assert.match(html, /class="aiui-field-body">[\s\S]*data-streamdown="strong">user<\/span> to fetch\./)
    assert.match(html, /id="param-tags" data-at="query" data-placeholder="red" data-deprecated=""><div class="aiui-field-head"><span class="aiui-field-pill">beta<\/span><a class="aiui-field-name"[^>]*>tags<\/a><span class="aiui-field-type">string\[\]<\/span><span class="aiui-field-pill">query<\/span><span class="aiui-field-pill" data-tone="deprecated">deprecated<\/span><span class="aiui-field-pill">v2<\/span><span class="aiui-field-pill">internal<\/span><span class="aiui-field-default">default: <code>all<\/code><\/span>/)
    assert.ok(!/<aiui-|user-content-/.test(html), html)
})

test('ResponseField with a nested Expandable: anchors follow the path; defaultOpen opens it', () => {
    const html = renderDocs([
        '<ResponseField name="user" type="object" required>',
        '  The user.',
        '  <Expandable title="user properties">',
        '    <ResponseField name="address" type="object">',
        '      <Expandable defaultOpen>',
        '        <ResponseField name="city" type="string">City.</ResponseField>',
        '      </Expandable>',
        '    </ResponseField>',
        '  </Expandable>',
        '</ResponseField>',
        '<ResponseField name="id" type="integer" id="custom-id" />',
    ].join('\n'))
    assert.match(html, /id="response-user" data-at="response"/)
    assert.doesNotMatch(html, /aiui-field-pill">response/)
    assert.match(html, /<details class="aiui-expandable"><summary><svg[\s\S]*?<span class="aiui-expandable-show">Show user properties<\/span><span class="aiui-expandable-hide">Hide user properties<\/span><\/summary>/)
    assert.match(html, /id="response-user-address"/)
    assert.match(html, /<details class="aiui-expandable" open="">[\s\S]*?Show properties/)
    assert.match(html, /id="response-user-address-city"/)
    assert.match(html, /id="custom-id"/)
})

test('RequestExample / ResponseExample become side panels: tabs for several fences, a plain block for one', () => {
    const md = [
        'Intro.',
        '',
        '<RequestExample dropdown>',
        '',
        '```bash cURL',
        'curl https://api.example.com/users/1',
        '```',
        '',
        '```python Python',
        'client.users.get(1)',
        '```',
        '',
        '</RequestExample>',
        '',
        '<ResponseExample>',
        '',
        '```json 200',
        '{ "id": 1 }',
        '```',
        '',
        '</ResponseExample>',
        '',
        '<Panel>',
        'Rate limit: 10 a second.',
        '</Panel>',
        '',
        'Outro.',
    ].join('\n')
    const pre = preprocessMkdocsMarkdown(md)
    assert.match(pre, /<aiui-panel kind="request">\s*<aiui-tabs variant="dropdown">[\s\S]*<aiui-tab title="cURL">[\s\S]*<aiui-tab title="Python">/)
    assert.match(pre, /<aiui-panel kind="response">\s*```json 200/)
    const { main, side } = splitPanels(pre)
    assert.match(main, /Intro\.[\s\S]*Outro\./)
    assert.doesNotMatch(main, /aiui-panel|curl|Rate limit/)
    assert.match(side, /^<aiui-panel kind="request">[\s\S]*kind="response"[\s\S]*Rate limit/)
    const html = render(side)
    assert.match(html, /<section class="aiui-panel" data-kind="request" aria-label="Request example">\s*<div class="aiui-tabs[^"]*" data-aiui-tabs="" data-variant="dropdown">/)
    assert.match(html, /<section class="aiui-panel" data-kind="response" aria-label="Response example">/)
    assert.match(html, /<div class="aiui-panel">[\s\S]*Rate limit/)
})

test('splitPanels leaves a page without panels, code that mentions one, and a panel in a list item alone', () => {
    const plain = '# Title\n\nText.'
    assert.deepEqual(splitPanels(plain), { main: plain, side: '' })
    const fenced = '````markdown\n<aiui-panel>\nx\n</aiui-panel>\n````'
    assert.deepEqual(splitPanels(fenced), { main: fenced, side: '' })
    const listed = preprocessMkdocsMarkdown('- Item\n  <Panel>Inside</Panel>')
    assert.equal(splitPanels(listed).side, '')
})

test('the build knows the new tags', () => {
    for (const el of ['aiui-field', 'aiui-expandable', 'aiui-panel']) assert.ok(DOCS_ALLOWED_ELEMENTS[el], el)
    assert.deepEqual([...new Set(DOCS_ALLOWED_ELEMENTS['aiui-field'])].sort(), ['anchor', 'at', 'dep', 'dflt', 'field', 'hint', 'post', 'pre', 'req', 'type'])
})

test('ApiPlayground: the endpoint bar (method, path, copy); Try it only with src', () => {
    const live = renderDocs('<ApiPlayground method="POST" path="/pets/{petId}" src="/openapi/try/api-reference/update-pet.json" />')
    assert.match(live, /<div class="aiui-endpoint"><span class="aiui-endpoint-method" data-method="POST">POST<\/span><code class="aiui-endpoint-path">\/pets\/\{petId\}<\/code>/)
    assert.match(live, /aria-label="Copy path"/)
    assert.match(live, />Try it<\/button>/)
    const simple = renderDocs('<ApiPlayground method="GET" path="/pets" />')
    assert.match(simple, /data-method="GET">GET</)
    assert.ok(!simple.includes('Try it'), simple)
    const gated = renderDocs('<ApiPlayground method="GET" path="/me" src="/openapi/try/me.json" display="auth" />')
    assert.ok(gated.includes('Copy path') && !gated.includes('Try it'), gated) // until the server says the reader is signed in
})
