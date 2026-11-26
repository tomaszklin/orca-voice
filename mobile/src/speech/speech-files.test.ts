import { describe, expect, it } from 'vitest'
import { speakableFiles } from './speech-files'

const name = (text: string) => speakableFiles(text, 'name')

describe('speakableFiles', () => {
  it('reads only the name of a path in backticks', () => {
    expect(name('`src/foo/plan-aktualny.md:12`')).toBe('plan aktualny')
    expect(name('`./scripts/build`')).toBe('build')
    expect(name('`C:\\Users\\me\\notes.txt`')).toBe('notes')
    expect(name('`.claude/skills/`')).toBe('skills')
    expect(name('`/etc/nginx/nginx.conf`')).toBe('nginx')
    expect(name('`Tools/gym.pending`')).toBe('gym.pending')
    expect(name('`config.yaml:29-31` and `app.js:8,12`')).toBe('config and app')
    expect(name('`.mcp.json`, `.env`')).toBe('mcp, env')
  })

  it('reads paths written as plain text, as in "Plik: E:\\…" at the end of a reply', () => {
    expect(name('Plik: E:\\Projects\\Home\\docs\\heat-pump.md')).toBe('Plik: heat pump')
    expect(name('Zapisane w profil/zawodnik.md, sprawdź.')).toBe('Zapisane w zawodnik, sprawdź.')
    expect(name('(see docs/plan.md:12)')).toBe('(see plan)')
    expect(name('**C:\\x\\notes.txt**')).toBe('**notes**')
    expect(name('Open file:///E:/Home/bom-checklist.html now')).toBe('Open bom checklist now')
    expect(name('Log: %TEMP%\\rename.log')).toBe('Log: rename')
    expect(name('Folders Tools/ and Config/.')).toBe('Folders Tools and Config.')
  })

  it('reads a file name without its extension, with spaces between its words', () => {
    expect(name('Read CLAUDE.md and `package.json`.')).toBe('Read CLAUDE and package.')
    expect(name('`ReleaseNotes.md`, `RunTests.bat`, `E:\\Projects\\PrivateChat`')).toBe(
      'Release Notes, Run Tests, Private Chat'
    )
  })

  it('cuts the paths in a command and keeps its other words', () => {
    expect(name('`Tools\\Scripts\\Compile.bat Development`')).toBe('Compile Development')
    expect(name('`C:\\Program Files\\Notepad++\\notepad++.exe`')).toBe('notepad++')
    expect(name('`GET /api/users`')).toBe('GET /api/users')
  })

  it('keeps word pairs, numbers, branches, commands, sites and libraries whole', () => {
    const anywhere = ['and/or', 'TCP/IP', 'FV/90/10/2026', 'origin/main', 'dev-5.6/5.7/5.8']
    const inText = ['Block/Overlap/Ignore', 'UI.Colour/UI.Font', '/api/users', 'React/Node.js']
    for (const text of [...anywhere, ...inText, 'Node.js', 'who.int', 'm.in.', 'e.g./i.e.']) {
      expect(name(text)).toBe(text)
    }
    for (const text of [...anywhere, '/code-review', 'Node.js', 'who.int', '.md']) {
      expect(name(`\`${text}\``)).toBe(text)
    }
  })

  it('reads file names joined by a slash one by one', () => {
    expect(name('AGENTS.md/CLAUDE.md')).toBe('AGENTS/CLAUDE')
  })

  it('can read the whole path as written, or skip it', () => {
    const text = 'Plan: `docs/plans/training-plan.md`, see E:\\a\\b.md.'
    expect(speakableFiles(text, 'full')).toBe('Plan: docs/plans/training-plan.md, see E:\\a\\b.md.')
    expect(speakableFiles(text, 'skip')).toBe('Plan: , see .')
  })
})
