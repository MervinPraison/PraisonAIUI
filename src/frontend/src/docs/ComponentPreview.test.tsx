import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComponentPreview } from '../blocks/BlockPage'
import { expandDocsTags } from '../markdown/docsTags'

test('expandDocsTags turns <ComponentPreview> body into escaped spec attribute', () => {
    const md = '<ComponentPreview title="Metric">\n{"type":"metric","label":"Users","value":"42"}\n</ComponentPreview>'
    const out = expandDocsTags(md)
    assert.match(out, /<aiui-preview title="Metric" spec="\{&quot;type&quot;:&quot;metric&quot;/)
})

test('ComponentPreview renders single and array block specs cleanly', () => {
    const html = renderToStaticMarkup(
        <ComponentPreview
            title="Metrics & Badge"
            spec={JSON.stringify([
                { type: 'metric', label: 'Active Agents', value: '128' },
                { type: 'badge', text: 'Healthy', variant: 'success' },
            ])}
        />,
    )
    assert.match(html, /data-aiui-component-preview=""/)
    assert.match(html, /Metrics &amp; Badge/)
    assert.match(html, /Active Agents/)
    assert.match(html, /128/)
    assert.match(html, /Healthy/)
})

test('ComponentPreview handles malformed JSON safely without throwing', () => {
    const html = renderToStaticMarkup(<ComponentPreview title="Broken" spec="{not valid json" />)
    assert.match(html, /Preview error:/)
})
