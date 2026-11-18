import { describe, expect, it } from 'vitest'

describe('main entry', () => {
  it('renders the app title into the #app root', async () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.append(root)

    await import('../src/main')

    const text = document.getElementById('app')?.textContent ?? ''
    expect(text).toContain('留白')

    root.remove()
  })
})
