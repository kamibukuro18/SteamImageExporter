import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useState, useRef } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { message, open } from '@tauri-apps/plugin-dialog'
import './App.css'

type Target = {
  name: string
  w: number
  h: number
  mode: 'fill' | 'fit' | 'fit_extend'
}

type CSSVars = CSSProperties & {
  '--delay'?: string
}

type FocusPoint = {
  x: number
  y: number
}

type ImageMeta = {
  naturalWidth: number
  naturalHeight: number
}

const STEAM_TARGETS: Target[] = [
  { name: 'header_capsule', w: 920, h: 430, mode: 'fill' },
  { name: 'small_capsule', w: 462, h: 174, mode: 'fill' },
  { name: 'main_capsule', w: 1232, h: 706, mode: 'fill' },
  { name: 'vertical_capsule', w: 748, h: 896, mode: 'fill' },
  { name: 'screenshot', w: 1920, h: 1080, mode: 'fill' },
  { name: 'page_background', w: 1438, h: 810, mode: 'fill' },
  { name: 'library_capsule', w: 600, h: 900, mode: 'fill' },
  { name: 'library_hero', w: 3840, h: 1240, mode: 'fill' },
  { name: 'library_logo', w: 1280, h: 720, mode: 'fill' },
  { name: 'event_cover', w: 800, h: 450, mode: 'fill' },
  { name: 'event_header', w: 1920, h: 622, mode: 'fill' },
  { name: 'broadcast_side_panel', w: 155, h: 337, mode: 'fill' },
  { name: 'community_icon', w: 184, h: 184, mode: 'fill' },
  { name: 'client_image', w: 16, h: 16, mode: 'fill' },
  { name: 'client_icon', w: 32, h: 32, mode: 'fill' },
]

const MODE_LABELS: Record<Target['mode'], string> = {
  fill: 'Fill (crop)',
  fit: 'Fit (black)',
  fit_extend: 'Fit Extend (blur)',
}

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
  const [focus, setFocus] = useState<FocusPoint | null>(null)
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null)
  const [exportMode, setExportMode] = useState<Target['mode']>('fill')
  const previewImageRef = useRef<HTMLImageElement | null>(null)

  const canExport = Boolean(inputPath && outputDir && !isBusy)
  const previewSrc = inputPath ? convertFileSrc(inputPath) : null
  const targetsToExport = STEAM_TARGETS.map((target) => ({
    ...target,
    mode: exportMode,
  }))
  const focusMarkerStyle =
    focus && imageMeta
      ? {
          left: `${(focus.x / imageMeta.naturalWidth) * 100}%`,
          top: `${(focus.y / imageMeta.naturalHeight) * 100}%`,
        }
      : undefined

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
        setFocus(null)
        setImageMeta(null)
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
        targets: targetsToExport,
        focus: focus ? { x: focus.x, y: focus.y } : null,
      })
      await message('Export complete.')
    } catch (err) {
      await message(`Export failed: ${String(err)}`)
    } finally {
      setIsBusy(false)
    }
  }

  const handlePreviewLoad = () => {
    const img = previewImageRef.current
    if (!img) {
      return
    }
    setImageMeta({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    })
  }

  const handlePreviewClick = (
    event: ReactMouseEvent<HTMLImageElement>,
  ) => {
    const img = previewImageRef.current
    if (!img || img.clientWidth === 0 || img.clientHeight === 0) {
      return
    }
    const rect = img.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top
    const focusX = Math.round(
      clickX * (img.naturalWidth / img.clientWidth),
    )
    const focusY = Math.round(
      clickY * (img.naturalHeight / img.clientHeight),
    )
    const clampedX = Math.min(Math.max(focusX, 0), img.naturalWidth - 1)
    const clampedY = Math.min(Math.max(focusY, 0), img.naturalHeight - 1)
    setFocus({ x: clampedX, y: clampedY })
    setImageMeta({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    })
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

          {previewSrc ? (
            <div className="step step--preview" style={stepStyle(40)}>
              <div className="step__row">
                <div>
                  <p className="step__label">Focus point</p>
                  <p className="step__hint">
                    Click the image to set focus. Default is center.
                  </p>
                </div>
                <button
                  className="button button--ghost"
                  onClick={() => setFocus(null)}
                  disabled={!focus || isBusy}
                >
                  Reset focus
                </button>
              </div>
              <div className="preview">
                <img
                  ref={previewImageRef}
                  src={previewSrc}
                  alt="Input preview"
                  onLoad={handlePreviewLoad}
                  onClick={handlePreviewClick}
                />
                {focus && imageMeta ? (
                  <span className="focus-marker" style={focusMarkerStyle} />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="step" style={stepStyle(80)}>
            <div className="step__row">
              <div>
                <p className="step__label">Mode</p>
                <p className="step__hint">Choose how the output fills the frame.</p>
              </div>
            </div>
            <div className="mode-select" role="group" aria-label="Export mode">
              {(Object.keys(MODE_LABELS) as Target['mode'][]).map((mode) => (
                <button
                  key={mode}
                  className={`mode-pill${exportMode === mode ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setExportMode(mode)}
                  disabled={isBusy}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          <div className="step" style={stepStyle(120)}>
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

          <div className="step step--cta" style={stepStyle(200)}>
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
              {targetsToExport.map((target) => (
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
