import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../dist/index.js'

test('plugin identity and exports', () => {
  assert.equal(plugin.name, 'search-everything')
  assert.deepEqual(plugin.inject, ['web'])
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.Config, 'Config schema is exported')
})

test('apply registers exactly one search provider', () => {
  const registered = []
  const ctx = {
    web: {
      registerSearchProvider: (provider) => registered.push(provider),
      registerFetchProvider: () => {},
    },
  }
  plugin.apply(ctx, { api_key: 'test-key' })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'search-everything')
  assert.equal(typeof registered[0].available, 'function')
  assert.equal(typeof registered[0].search, 'function')
})

test('provider stays available without any key (Firecrawl keyless)', () => {
  const registered = []
  plugin.apply(
    { web: { registerSearchProvider: (p) => registered.push(p), registerFetchProvider: () => {} } },
    {},
  )
  assert.equal(registered[0].available(), true)
})

test('parseResults reads the markdown answer', () => {
  const provider = new plugin.AnysearchProvider('k')
  const text = [
    '### 1. DeepSeek Harness',
    '- **URL**: https://github.com/deepseek-ai/deepseek-harness',
    'The harness repository.',
    '',
    '### 2. Cordis',
    '- **URL**: https://github.com/cordiverse/cordis',
    'A framework.',
  ].join('\n')
  const sources = provider.parseResults(text)
  assert.equal(sources.length, 2)
  assert.equal(sources[0].url, 'https://github.com/deepseek-ai/deepseek-harness')
  assert.equal(sources[1].title, 'Cordis')
})

test('parseResults falls back to JSON payloads', () => {
  const provider = new plugin.AnysearchProvider('k')
  const payload = JSON.stringify({
    results: [{ title: 'T', url: 'https://example.com', snippet: 'S' }],
  })
  assert.deepEqual(provider.parseResults(payload), [
    { url: 'https://example.com', title: 'T', snippet: 'S' },
  ])
})

test('query intent routing helpers', () => {
  assert.equal(plugin.isDeveloperQuery('how to open a pull request'), true)
  assert.equal(plugin.isNewsQuery('latest news today'), true)
  assert.equal(plugin.isAcademicQuery('arxiv paper on routing'), true)
  assert.equal(plugin.isNewsQuery('what is a monad'), false)
})
