// Seed conversion contract for themes.ts (WP0b). Runs under `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    NAMED_THEME_PRESETS,
    NEUTRAL_TINTS,
    PRESET_ACCENTS,
    THEME_PRESETS,
    applySeedVars,
    legacyColorValue,
    legacyVarsToSeeds,
    presetSeedVars,
    seedCss,
    upgradeLegacyCss,
} from '@/themes'

test('neutral presets are monochrome: the accent follows the ink', () => {
    for (const name of Object.keys(NEUTRAL_TINTS)) {
        const seeds = presetSeedVars(name)
        assert.equal(seeds['--seed-tint'], NEUTRAL_TINTS[name])
        assert.equal(seeds['--accent-mix'], '0%')
        assert.equal(seeds['--seed-accent'], 'var(--seed-ink)')
        assert.ok(!('--seed-accent-light' in seeds))
    }
})

test('colour presets seed the 600 shade for light and the 500 shade for dark', () => {
    assert.deepEqual(presetSeedVars('blue'), {
        '--seed-tint': '#71717a',
        '--accent-mix': '4%',
        '--seed-accent-light': '#2563eb',
        '--seed-accent-dark': '#3b82f6',
    })
    assert.equal(presetSeedVars('rose')['--seed-accent-dark'], '#f43f5e')
})

test('every preset name is either neutral or has accents', () => {
    for (const name of THEME_PRESETS) {
        assert.ok(name in NEUTRAL_TINTS || name in PRESET_ACCENTS, name)
    }
})

test('unknown presets fall back to zinc', () => {
    assert.deepEqual(presetSeedVars('nope'), presetSeedVars('zinc'))
})

test('legacyColorValue wraps bare HSL triples only', () => {
    assert.equal(legacyColorValue('221.2 83.2% 53.3%'), 'hsl(221.2 83.2% 53.3%)')
    assert.equal(legacyColorValue(' 222.2 84% 4.9% / 0.8 '), 'hsl(222.2 84% 4.9% / 0.8)')
    assert.equal(legacyColorValue('200deg 50% 3%'), 'hsl(200deg 50% 3%)')
    assert.equal(legacyColorValue('#0077b6'), '#0077b6')
    assert.equal(legacyColorValue('oklch(0.6 0.2 250)'), 'oklch(0.6 0.2 250)')
})

test('legacyVarsToSeeds maps shadcn vars onto seeds and drops derived ones', () => {
    const seeds = legacyVarsToSeeds(NAMED_THEME_PRESETS.soft.styles)
    assert.deepEqual(seeds, {
        '--seed-paper': 'hsl(0 0% 98%)',
        '--seed-ink': 'hsl(222.2 84% 4.9%)',
        '--seed-raised': 'hsl(0 0% 100%)',
        '--seed-accent': 'hsl(221.2 83.2% 53.3%)',
        '--seed-accent-fg': 'hsl(210 40% 98%)',
        '--seed-sunken': 'hsl(210 40% 96.1%)',
    })
    // --card wins over a later --popover for --seed-raised
    assert.equal(legacyVarsToSeeds({ '--card': '#111', '--popover': '#222' })['--seed-raised'], '#111')
})

test('every named preset converts to seeds without HSL triples left over', () => {
    for (const preset of Object.values(NAMED_THEME_PRESETS)) {
        for (const value of Object.values(legacyVarsToSeeds(preset.styles))) {
            assert.match(value, /^hsl\(/)
        }
    }
})

test('upgradeLegacyCss wraps triples and adds the matching seed', () => {
    const css = ':root{--primary: 221 83% 53%;--radius:0.5rem}\n.dark { --background: 0 0% 3.9% !important; }'
    const out = upgradeLegacyCss(css)
    assert.equal(
        out,
        ':root{--primary: hsl(221 83% 53%); --seed-accent: hsl(221 83% 53%);--radius:0.5rem}\n' +
            '.dark { --background: hsl(0 0% 3.9%) !important; --seed-paper: hsl(0 0% 3.9%) !important; }',
    )
    // idempotent
    assert.equal(upgradeLegacyCss(out), out)
})

test('upgradeLegacyCss leaves derived vars as full colours without seeds', () => {
    assert.equal(upgradeLegacyCss('a{--border:220 13% 91%}'), 'a{--border: hsl(220 13% 91%)}')
    assert.equal(upgradeLegacyCss(':root{--db-bg: 0 0% 3%}'), ':root{--db-bg: 0 0% 3%}')
    assert.equal(upgradeLegacyCss(':root{--primary: #2563eb}'), ':root{--primary: #2563eb}')
})

test('applySeedVars ranks YAML presets below server seeds and named presets above', () => {
    const nodes: Record<string, { id: string; textContent: string }> = {}
    const g = globalThis as unknown as { document?: unknown }
    const saved = g.document
    g.document = {
        head: {
            insertBefore(el: { id: string; textContent: string }) {
                nodes[el.id] = el
            },
        },
        getElementById: (id: string) => nodes[id] ?? null,
        createElement: () => ({ id: '', textContent: '' }),
    }
    try {
        applySeedVars({ '--seed-accent-light': '#2563eb' })
        assert.equal(nodes['aiui-runtime-seeds'].textContent, ':where(:root) { --seed-accent-light: #2563eb; }')
        applySeedVars({ '--seed-accent': 'hsl(1 2% 3%)' }, 'override')
        assert.equal(nodes['aiui-runtime-seeds'].textContent, 'html:root { --seed-accent: hsl(1 2% 3%); }')
        assert.equal(Object.keys(nodes).length, 1) // one element, replaced in place
    } finally {
        g.document = saved
    }
})

test('seedCss drops unsafe names and values', () => {
    assert.equal(
        seedCss({ '--seed-accent': '#fff', '--x;y': 'red', '--seed-ink': 'red;} body{color:red' }),
        ':root { --seed-accent: #fff; }',
    )
})
