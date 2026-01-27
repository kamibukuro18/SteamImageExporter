import type { CSSProperties } from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { message, open } from '@tauri-apps/plugin-dialog'
import './App.css'

type Target = {
  name: string
  w: number
  h: number
}

type CSSVars = CSSProperties & {
  '--delay'?: string
}

const STEAM_TARGETS: Target[] = [
  { name: 'header_capsule', w: 920, h: 430 },
  { name: 'small_capsule', w: 462, h: 174 },
  { name: 'main_capsule', w: 1232, h: 706 },
  { name: 'vertical_capsule', w: 748, h: 896 },
  { name: 'screenshot', w: 1920, h: 1080 },
  { name: 'page_background', w: 1438, h: 810 },
  { name: 'library_capsule', w: 600, h: 900 },
  { name: 'library_hero', w: 3840, h: 1240 },
  { name: 'library_logo', w: 1280, h: 720 },
  { name: 'event_cover', w: 800, h: 450 },
  { name: 'event_header', w: 1920, h: 622 },
  { name: 'broadcast_side_panel', w: 155, h: 337 },
  { name: 'community_icon', w: 184, h: 184 },
  { name: 'client_image', w: 16, h: 16 },
  { name: 'client_icon', w: 32, h: 32 },
]

const stepStyle = (delayMs: number): CSSVars => ({
  '--delay': `${delayMs}ms`,
})

const resolveSelection = (value: string | string[] | null): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function App() {
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const canExport = Boolean(inputPath && outputDir && !isBusy)

  const handlePickInput = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Image',
            extensions: ['png', 'jpg', 'jpeg', 'webp'],
          },
        ],
      })
      const resolved = resolveSelection(selected)
      if (resolved) {
        setInputPath(resolved)
      }
    } catch (err) {
      await message(`Failed to open file picker: ${String(err)}`)
    }
  }

  const handlePickOutput = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      })
      const resolved = resolveSelection(selected)
      if (resolved) {
        setOutputDir(resolved)
      }
    } catch (err) {
      await message(`Failed to open folder picker: ${String(err)}`)
    }
  }

  const handleExport = async () => {
    if (!inputPath || !outputDir) {
      await message('Select an input image and output folder first.')
      return
    }
    setIsBusy(true)
    try {
      await invoke('export_images', {
        inputPath,
        outputDir,
        targets: STEAM_TARGETS,
      })
      await message('Export complete.')
    } catch (err) {
      await message(`Export failed: ${String(err)}`)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Steam Image Exporter</p>
        <h1>Generate every Steam size from a single key art image.</h1>
        <p className="lede">
          Center-crop, Lanczos resize, PNG output. One click, no manual edits.
        </p>
        <div className="hero__meta">
          <span className="pill">Center crop</span>
          <span className="pill">Lanczos3 resize</span>
          <span className="pill">PNG output</span>
        </div>
      </header>

      <main className="layout">
        <section className="panel" aria-busy={isBusy}>
          <div className="step" style={stepStyle(0)}>
            <div className="step__row">
              <div>
                <p className="step__label">1 Input image</p>
                <p className="step__hint">png, jpg, jpeg, webp</p>
              </div>
              <button
                className="button button--ghost"
                onClick={handlePickInput}
                disabled={isBusy}
              >
                Choose image
              </button>
            </div>
            <p className="path">{inputPath ?? 'Not selected'}</p>
          </div>

          <div className="step" style={stepStyle(80)}>
            <div className="step__row">
              <div>
                <p className="step__label">2 Output folder</p>
                <p className="step__hint">Files overwrite existing outputs</p>
              </div>
              <button
                className="button button--ghost"
                onClick={handlePickOutput}
                disabled={isBusy}
              >
                Choose folder
              </button>
            </div>
            <p className="path">{outputDir ?? 'Not selected'}</p>
          </div>

          <div className="step step--cta" style={stepStyle(160)}>
            <div className="step__row">
              <div>
                <p className="step__label">3 Export</p>
                <p className="step__hint">
                  {isBusy ? 'Processing images now.' : 'Ready to generate.'}
                </p>
              </div>
              <button
                className="button button--primary"
                onClick={handleExport}
                disabled={!canExport}
              >
                {isBusy ? 'Exporting...' : 'Export Steam Set'}
              </button>
            </div>
            <div className="status" data-busy={isBusy ? 'true' : 'false'}>
              <span className="status__dot" />
              <span>{isBusy ? 'Working...' : 'Idle'}</span>
            </div>
          </div>
        </section>

        <aside className="side">
          <div className="card">
            <h2>Steam preset</h2>
            <ul className="targets">
              {STEAM_TARGETS.map((target) => (
                <li key={target.name}>
                  <span className="targets__name">{target.name}</span>
                  <span className="targets__size">
                    {target.w}x{target.h}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card card--note">
            <h3>Output naming</h3>
            <p>{'{name}_{width}x{height}.png'}</p>
            <p className="note">
              Example: capsule_main_616x353.png
            </p>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
