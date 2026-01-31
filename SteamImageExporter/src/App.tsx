import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { dirname } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, open } from '@tauri-apps/plugin-dialog'
import { open as openPath } from '@tauri-apps/plugin-shell'
import './App.css'

type Target = {
  name: string
  w: number
  h: number
  mode: 'fill' | 'fit' | 'fit_extend'
}

type CSSVars = CSSProperties & {
  '--delay'?: string
  '--progress'?: string
}

type FocusPoint = {
  x: number
  y: number
}

type ImageMeta = {
  naturalWidth: number
  naturalHeight: number
}

type ProgressPayload = {
  index: number
  total: number
  name: string
  phase: 'render' | 'save'
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
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    () => new Set(STEAM_TARGETS.map((target) => target.name)),
  )
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const [progress, setProgress] = useState<ProgressPayload | null>(null)
  const [lastOutputDir, setLastOutputDir] = useState<string | null>(null)

  const previewSrc = inputPath ? convertFileSrc(inputPath) : null
  const targetsToExport = STEAM_TARGETS.filter((target) =>
    selectedNames.has(target.name),
  ).map((target) => ({
    ...target,
    mode: exportMode,
  }))
  const canExport = Boolean(
    inputPath && outputDir && !isBusy && targetsToExport.length > 0,
  )
  const focusMarkerStyle =
    focus && imageMeta
      ? {
          left: `${(focus.x / imageMeta.naturalWidth) * 100}%`,
          top: `${(focus.y / imageMeta.naturalHeight) * 100}%`,
        }
      : undefined
  const progressPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.index / progress.total) * 100))
      : 0
  const progressStyle: CSSVars = { '--progress': `${progressPercent}%` }
  const progressLabel = progress
    ? `${progress.index}/${progress.total} • ${progress.name} (${progress.phase})`
    : null

  const setInputFile = (path: string) => {
    setInputPath(path)
    setFocus(null)
    setImageMeta(null)
    void dirname(path).then((dir) => {
      setOutputDir(dir)
    })
  }

  useEffect(() => {
    let unlistenProgress: (() => void) | null = null
    let unlistenComplete: (() => void) | null = null

    listen<ProgressPayload>('export://progress', (event) => {
      setProgress(event.payload)
    }).then((unlisten) => {
      unlistenProgress = unlisten
    })

    listen('export://complete', () => {
      setProgress(null)
    }).then((unlisten) => {
      unlistenComplete = unlisten
    })

    return () => {
      if (unlistenProgress) {
        unlistenProgress()
      }
      if (unlistenComplete) {
        unlistenComplete()
      }
    }
  }, [])

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let unlistenDrop: (() => void) | null = null

    appWindow
      .onDragDropEvent((event) => {
        const payload = (event as { payload?: unknown }).payload as
          | {
              type?: string
              paths?: string[]
            }
          | undefined
        if (payload?.type !== 'drop') {
          return
        }
        const paths = payload.paths ?? []
        const first = paths[0]
        if (!first) {
          return
        }
        const lower = first.toLowerCase()
        if (!['.png', '.jpg', '.jpeg', '.webp'].some((ext) => lower.endsWith(ext))) {
          void message('Unsupported file. Use png, jpg, jpeg, or webp.')
          return
        }
        setInputFile(first)
      })
      .then((unlisten) => {
        unlistenDrop = unlisten
      })

    return () => {
      if (unlistenDrop) {
        unlistenDrop()
      }
    }
  }, [])

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
        setInputFile(resolved)
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
      await message('Select an input image and output location first.')
      return
    }
    if (targetsToExport.length === 0) {
      await message('Select at least one output size.')
      return
    }
    setIsBusy(true)
    setProgress(null)
    try {
      const exportedDir = await invoke<string>('export_images', {
        inputPath,
        outputDir,
        targets: targetsToExport,
        focus: focus ? { x: focus.x, y: focus.y } : null,
      })
      setLastOutputDir(exportedDir)
      await message('Export complete.')
      try {
        await openPath(exportedDir)
      } catch (openErr) {
        await message(`Exported, but failed to open folder: ${String(openErr)}`)
      }
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

  const toggleTarget = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const selectAllTargets = () => {
    setSelectedNames(new Set(STEAM_TARGETS.map((target) => target.name)))
  }

  const clearAllTargets = () => {
    setSelectedNames(new Set())
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
            <p className="drop-hint">Drag & drop an image anywhere in the window.</p>
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
                <p className="step__label">2 Output drive</p>
                <p className="step__hint">
                  A new folder is created inside the selected location.
                </p>
              </div>
              <button
                className="button button--ghost"
                onClick={handlePickOutput}
                disabled={isBusy}
              >
                Choose location
              </button>
            </div>
            <p className="path">{outputDir ?? 'Not selected'}</p>
            {lastOutputDir ? (
              <p className="path path--note">Last output: {lastOutputDir}</p>
            ) : null}
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
              <span>{progressLabel ?? (isBusy ? 'Working...' : 'Idle')}</span>
            </div>
            {isBusy ? (
              <div className="progress" style={progressStyle}>
                <span className="progress__bar" />
              </div>
            ) : null}
          </div>
        </section>

        <aside className="side">
          <div className="card">
            <div className="card__head">
              <h2>Steam preset</h2>
              <div className="card__actions">
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={selectAllTargets}
                  disabled={isBusy}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={clearAllTargets}
                  disabled={isBusy}
                >
                  Clear all
                </button>
              </div>
            </div>
            <ul className="targets">
              {STEAM_TARGETS.map((target) => (
                <li key={target.name}>
                  <label className="targets__check">
                    <input
                      type="checkbox"
                      checked={selectedNames.has(target.name)}
                      onChange={() => toggleTarget(target.name)}
                      disabled={isBusy}
                    />
                    <span className="targets__name">{target.name}</span>
                  </label>
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
