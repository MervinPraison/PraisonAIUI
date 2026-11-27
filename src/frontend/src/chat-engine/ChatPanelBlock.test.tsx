import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chatBuiltin } from '../builtin/chat'
import { sdkApi } from '@/sdk/install'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { getBlock } from '@/sdk/registry'
import ChatPage from './ChatPage'
import ChatPanelBlock from './ChatPanelBlock'
import type { AiuiTransport } from './transports'

const noopTransport: AiuiTransport = {
  kind: 'sse',
  async send() {},
  async cancel() {},
  async respondAsk() {},
}

const manifest: ShellManifest = {
  sdkVersion: 1,
  apiVersion: 1,
  site: { title: 'Test', style: 'app' },
  pages: [],
  plugins: [],
} as unknown as ShellManifest

const panelPage: ShellPage = {
  id: 'chat-panel',
  title: 'Doc Assistant',
  kind: 'native',
  icon: 'message-square',
  group: 'Workspace',
  order: 0,
}

test('chatBuiltin registers lazy chat_panel block via @aiui/sdk without polluting core', () => {
  chatBuiltin.activate(sdkApi, { manifest, pageIds: ['chat'] })
  assert.ok(getBlock('chat_panel'), 'chat_panel block should be registered by builtin.chat')
})

test('ChatPanelBlock renders bounded container with data-aiui-chat-panel', () => {
  const html = renderToStaticMarkup(
    createElement(ChatPanelBlock, {
      transport: noopTransport,
      node: { type: 'chat_panel', props: { title: 'Doc Assistant', height: 600 } },
    }),
  )
  assert.match(html, /data-aiui-chat-panel=""/)
  assert.match(html, /height:600px/)
})

test('ChatPage embedded mode renders panel title without session rail', () => {
  const html = renderToStaticMarkup(
    createElement(ChatPage, {
      page: panelPage,
      transport: noopTransport,
      embedded: { agent: 'analyst', welcome: 'Ask about this table' },
    }),
  )
  assert.match(html, /Doc Assistant/)
  assert.doesNotMatch(html, /Show chats/)
})
