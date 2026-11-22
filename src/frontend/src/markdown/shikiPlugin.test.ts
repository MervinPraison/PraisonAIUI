import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chosenThemes, createCuratedCodePlugin, resolveLanguage } from './shikiPlugin'

type Tok = { content: string; htmlStyle?: Record<string, string> }
type Plugin = ReturnType<typeof createCuratedCodePlugin>

const DEFAULT: [string, string] = ['github-light', 'github-dark']

function highlight(plugin: Plugin, code: string, language: string): Promise<Tok[][]> {
    return new Promise((resolve) => {
        const sync = plugin.highlight({ code, language, themes: DEFAULT as never, isIncomplete: false }, (r) => resolve(r.tokens as Tok[][]))
        if (sync) resolve(sync.tokens as Tok[][])
    })
}

/** The distinct light colours in a result: plain text has one. */
const colours = (tokens: Tok[][]) => new Set(tokens.flat().map((t) => t.htmlStyle?.color))

test('code theme: site.theme.code picks each mode, the rest stays the default', () => {
    assert.deepEqual(chosenThemes(DEFAULT, undefined), DEFAULT)
    assert.deepEqual(chosenThemes(DEFAULT, { dark: 'nord' }), ['github-light', 'nord'])
    assert.deepEqual(chosenThemes(DEFAULT, { light: 'dracula', dark: 'dracula' }), ['dracula', 'dracula'])
})

test('site grammars register under their name and aliases, fetched on first use', async () => {
    const grammar = {
        scopeName: 'source.greet',
        patterns: [
            { match: '\\bhello\\b', name: 'keyword.control.greet' },
            { match: '\\d+', name: 'constant.numeric.greet' },
        ],
    }
    const fetched: string[] = []
    globalThis.fetch = (async (url: string) => {
        fetched.push(String(url))
        return new Response(JSON.stringify(grammar), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    // A theme the test build cannot load falls back to the mode's default.
    globalThis.__AIUI_CODE__ = { code: { light: 'no-such-theme' }, codeLanguages: [{ name: 'greet', aliases: ['gr'], url: '/grammars/greet.json?v=1' }] }
    const plugin = createCuratedCodePlugin(DEFAULT)

    assert.equal(resolveLanguage('GR'), 'greet')
    assert.equal(plugin.supportsLanguage('gr'), true)
    assert.equal(plugin.supportsLanguage('cobol'), false)
    const tokens = await highlight(plugin, 'hello world 42', 'gr')
    assert.deepEqual(fetched, ['/grammars/greet.json?v=1'])
    assert.equal(tokens.flat().map((t) => t.content).join(''), 'hello world 42')
    assert.ok(colours(tokens).size >= 2, 'keyword and number are coloured')
    assert.deepEqual(plugin.getThemes(), DEFAULT)
})

test('more curated languages, and their common aliases, highlight', async () => {
    const plugin = createCuratedCodePlugin(DEFAULT)
    for (const [lang, code] of [
        ['tf', 'resource "aws_s3_bucket" "b" {\n  bucket = "x"\n}'],
        ['ps1', 'Get-ChildItem -Path $HOME | Where-Object { $_.Length -gt 1 }'],
        ['vue', '<template><div :id="x">{{ msg }}</div></template>'],
        ['makefile', 'all:\n\techo $(CC)'],
    ]) {
        assert.equal(plugin.supportsLanguage(lang), true, lang)
        // The first highlight loads the grammar and compiles its patterns inside
        // the tokenize time limit, which a busy machine can overrun (the line then
        // comes back plain). Await that load, then check a fresh (uncached) block.
        await highlight(plugin, `${code}\n`, lang)
        assert.ok(colours(await highlight(plugin, code, lang)).size >= 2, `${lang} is highlighted`)
    }
})
