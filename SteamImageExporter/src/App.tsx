import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
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

type DropZoneType = 'input' | 'logo' | 'logo_tool'
type AppTab = 'export' | 'logo_tool' | 'template'
type TemplatePreset = 'balanced' | 'impact' | 'compact' | 'cinematic' | 'corner'
type Locale = 'en' | 'ja'

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

const TEMPLATE_PRESETS: TemplatePreset[] = [
  'balanced',
  'impact',
  'compact',
  'cinematic',
  'corner',
]

const LOGO_TEMPLATE_TARGETS: Array<{ name: string; w: number; h: number }> = [
  { name: 'header_capsule', w: 920, h: 430 },
  { name: 'small_capsule', w: 462, h: 174 },
  { name: 'main_capsule', w: 1232, h: 706 },
  { name: 'vertical_capsule', w: 748, h: 896 },
  { name: 'library_capsule', w: 600, h: 900 },
]

const TEMPLATE_SAMPLE_KEYART = '/template-samples/keyart-sample.png'
const TEMPLATE_SAMPLE_LOGO = '/template-samples/logo-sample.png'

const tr = (locale: Locale, en: string, ja: string): string => (
  locale === 'ja' ? ja : en
)

const templatePresetMeta = (
  locale: Locale,
  preset: TemplatePreset,
): { title: string; description: string } => {
  switch (preset) {
    case 'balanced':
      return {
        title: 'Balanced',
        description: tr(locale, 'Centered and stable composition.', '中央寄せで安定した見え方。'),
      }
    case 'impact':
      return {
        title: 'Impact',
        description: tr(locale, 'Larger logo for stronger presence.', '大きめロゴで強い印象。'),
      }
    case 'compact':
      return {
        title: 'Compact',
        description: tr(locale, 'Smaller logo to show more background.', '小さめで背景を見せる。'),
      }
    case 'cinematic':
      return {
        title: 'Cinematic',
        description: tr(locale, 'Upper placement for cinematic framing.', '上寄せでシネマ風。'),
      }
    case 'corner':
      return {
        title: 'Corner',
        description: tr(locale, 'Place logo at bottom-right corner.', '右下の隅に配置。'),
      }
  }
}

const stepStyle = (delayMs: number): CSSVars => ({
  '--delay': `${delayMs}ms`,
})

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

const isSupportedImagePath = (path: string): boolean => {
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

const resolveSelection = (value: string | string[] | null): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

const modeLabel = (locale: Locale, mode: Target['mode']): string => {
  if (locale === 'ja') {
    if (mode === 'fill') return 'Fill（切り抜き）'
    if (mode === 'fit') return 'Fit（黒背景）'
    return 'Fit Extend（ぼかし）'
  }
  return MODE_LABELS[mode]
}

function App() {
  const [locale, setLocale] = useState<Locale>('en')
  const [appTab, setAppTab] = useState<AppTab>('export')
  const [selectedTemplate, setSelectedTemplate] = useState<TemplatePreset>('balanced')
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [logoOutputDir, setLogoOutputDir] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isLogoBusy, setIsLogoBusy] = useState(false)
  const [focus, setFocus] = useState<FocusPoint | null>(null)
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null)
  const [exportMode, setExportMode] = useState<Target['mode']>('fill')
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    () => new Set(STEAM_TARGETS.map((target) => target.name)),
  )
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const inputDropZoneRef = useRef<HTMLDivElement | null>(null)
  const logoDropZoneRef = useRef<HTMLDivElement | null>(null)
  const logoToolDropZoneRef = useRef<HTMLDivElement | null>(null)
  const [activeDropZone, setActiveDropZone] = useState<DropZoneType | null>(null)
  const [progress, setProgress] = useState<ProgressPayload | null>(null)
  const [lastOutputDir, setLastOutputDir] = useState<string | null>(null)
  const [lastLogoOutputPath, setLastLogoOutputPath] = useState<string | null>(null)
  const [rememberOutputDir, setRememberOutputDir] = useState(false)
  const [logoAspectRatio, setLogoAspectRatio] = useState<number | null>(null)

  const previewSrc = inputPath ? convertFileSrc(inputPath) : null
  const logoPreviewSrc = logoPath ? convertFileSrc(logoPath) : null
  const templateKeyartSrc = previewSrc ?? TEMPLATE_SAMPLE_KEYART
  const templateLogoSrc = logoPreviewSrc ?? TEMPLATE_SAMPLE_LOGO
  const targetsToExport = STEAM_TARGETS.filter((target) =>
    selectedNames.has(target.name),
  ).map((target) => ({
    ...target,
    mode: exportMode,
  }))
  const canExport = Boolean(
    inputPath && outputDir && !isBusy && targetsToExport.length > 0,
  )
  const canCreateTransparentLogo = Boolean(logoPath && logoOutputDir && !isLogoBusy)
  const canRenderTemplatePreview = Boolean(templateKeyartSrc && templateLogoSrc)
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
  }

  const setLogoFile = (path: string) => {
    setLogoPath(path)
  }

  const resolveDropZoneFromPosition = (
    position: { x: number; y: number },
  ): DropZoneType | null => {
    const scale = window.devicePixelRatio || 1
    const x = position.x / scale
    const y = position.y / scale
    const zones: Array<{ kind: DropZoneType; element: HTMLDivElement | null }> = [
      { kind: 'input', element: inputDropZoneRef.current },
      { kind: 'logo', element: logoDropZoneRef.current },
      { kind: 'logo_tool', element: logoToolDropZoneRef.current },
    ]
    for (const zone of zones) {
      const rect = zone.element?.getBoundingClientRect()
      if (!rect) {
        continue
      }
      const inX = x >= rect.left && x <= rect.right
      const inY = y >= rect.top && y <= rect.bottom
      if (inX && inY) {
        return zone.kind
      }
    }
    return null
  }

  const getTemplateOverlayStyle = (
    targetName: string,
    preset: TemplatePreset,
  ): CSSProperties => {
    const map: Record<TemplatePreset, Record<string, { width: number; maxHeight: number; x?: number; y: number; marginX: number; marginY: number }>> = {
      balanced: {
        header_capsule: { width: 42, maxHeight: 62, y: 20, marginX: 4, marginY: 4 },
        small_capsule: { width: 50, maxHeight: 72, y: 18, marginX: 4, marginY: 8 },
        main_capsule: { width: 48, maxHeight: 56, y: 18, marginX: 4, marginY: 4 },
        vertical_capsule: { width: 70, maxHeight: 34, y: -2, marginX: 5, marginY: 4 },
        library_capsule: { width: 78, maxHeight: 32, y: -3, marginX: 5, marginY: 4 },
      },
      impact: {
        header_capsule: { width: 84, maxHeight: 96, y: 0, marginX: 5, marginY: 5 },
        small_capsule: { width: 68, maxHeight: 88, y: 0, marginX: 5, marginY: 10 },
        main_capsule: { width: 66, maxHeight: 70, y: 0, marginX: 5, marginY: 5 },
        vertical_capsule: { width: 82, maxHeight: 42, y: 0, marginX: 6, marginY: 5 },
        library_capsule: { width: 90, maxHeight: 44, y: 0, marginX: 6, marginY: 5 },
      },
      compact: {
        header_capsule: { width: 34, maxHeight: 52, y: 14, marginX: 4, marginY: 4 },
        small_capsule: { width: 42, maxHeight: 62, y: 12, marginX: 4, marginY: 8 },
        main_capsule: { width: 40, maxHeight: 46, y: 12, marginX: 4, marginY: 4 },
        vertical_capsule: { width: 62, maxHeight: 30, y: -4, marginX: 5, marginY: 4 },
        library_capsule: { width: 70, maxHeight: 28, y: -6, marginX: 5, marginY: 4 },
      },
      cinematic: {
        header_capsule: { width: 46, maxHeight: 62, y: -20, marginX: 4, marginY: 4 },
        small_capsule: { width: 56, maxHeight: 76, y: -12, marginX: 4, marginY: 12 },
        main_capsule: { width: 54, maxHeight: 58, y: -16, marginX: 4, marginY: 4 },
        vertical_capsule: { width: 72, maxHeight: 36, y: -22, marginX: 5, marginY: 4 },
        library_capsule: { width: 82, maxHeight: 36, y: -20, marginX: 5, marginY: 4 },
      },
      corner: {
        header_capsule: { width: 24, maxHeight: 40, x: 0, y: 0, marginX: 3, marginY: 4 },
        small_capsule: { width: 28, maxHeight: 46, x: 0, y: 0, marginX: 3, marginY: 9 },
        main_capsule: { width: 28, maxHeight: 34, x: 0, y: 0, marginX: 3, marginY: 4 },
        vertical_capsule: { width: 46, maxHeight: 28, x: 0, y: 0, marginX: 4, marginY: 5 },
        library_capsule: { width: 50, maxHeight: 24, x: 0, y: 0, marginX: 4, marginY: 5 },
      },
    }
    const base = map[preset][targetName] ?? { width: 70, maxHeight: 40, y: 0, marginX: 4, marginY: 4 }
    let width = base.width
    let maxHeightValue = base.maxHeight
    let x = base.x ?? 0
    let y = base.y
    let marginX = base.marginX
    let marginY = base.marginY
    if (logoAspectRatio !== null && Number.isFinite(logoAspectRatio)) {
      if (logoAspectRatio < 0.9) {
        const t = Math.min(1, Math.max(0, (0.9 - logoAspectRatio) / 0.9))
        maxHeightValue = maxHeightValue * (1 - 0.24 * t)
        marginY = marginY + 4 * t
        y = y * (1 - 0.8 * t)
      } else if (logoAspectRatio > 1.1) {
        const t = Math.min(1, Math.max(0, (logoAspectRatio - 1.1) / 2.4))
        width = width * (1 - 0.15 * t)
        marginX = marginX + 2 * t
        x = x * (1 - 0.35 * t)
      }
    }
    const maxWidth = `min(${width}%, calc(100% - ${marginX * 2}%))`
    const maxHeight = `min(${maxHeightValue}%, calc(100% - ${marginY * 2}%))`
    if (preset === 'corner') {
      return {
        width: maxWidth,
        maxWidth,
        maxHeight,
        right: `${marginX + x}%`,
        bottom: `${marginY + y}%`,
      }
    }
    return {
      width: maxWidth,
      maxWidth,
      maxHeight,
      left: '50%',
      top: `${50 + y}%`,
      transform: 'translate(-50%, -50%)',
    }
  }

  useEffect(() => {
    const storedLocale = localStorage.getItem('locale')
    if (storedLocale === 'en' || storedLocale === 'ja') {
      setLocale(storedLocale)
    }
    const storedRemember = localStorage.getItem('rememberOutputDir') === 'true'
    const storedOutputDir = localStorage.getItem('outputDir')
    const storedTemplate = localStorage.getItem('logoTemplatePreset')
    if (
      storedTemplate === 'balanced'
      || storedTemplate === 'impact'
      || storedTemplate === 'compact'
      || storedTemplate === 'cinematic'
      || storedTemplate === 'corner'
    ) {
      setSelectedTemplate(storedTemplate)
    }
    if (storedRemember && storedOutputDir) {
      setOutputDir(storedOutputDir)
      setLogoOutputDir(storedOutputDir)
      setRememberOutputDir(true)
    } else if (storedRemember) {
      setRememberOutputDir(true)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('locale', locale)
  }, [locale])

  useEffect(() => {
    localStorage.setItem('logoTemplatePreset', selectedTemplate)
  }, [selectedTemplate])

  useEffect(() => {
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled && probe.naturalHeight > 0) {
        setLogoAspectRatio(probe.naturalWidth / probe.naturalHeight)
      }
    }
    probe.onerror = () => {
      if (!cancelled) {
        setLogoAspectRatio(null)
      }
    }
    probe.src = templateLogoSrc
    return () => {
      cancelled = true
    }
  }, [templateLogoSrc])

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
        const payload = event.payload
        if (payload.type === 'over') {
          setActiveDropZone(resolveDropZoneFromPosition(payload.position))
          return
        }
        if (payload.type === 'leave') {
          setActiveDropZone(null)
          return
        }
        if (payload.type === 'drop') {
          setActiveDropZone(null)
          const first = payload.paths[0]
          if (!first) {
            return
          }
          if (!isSupportedImagePath(first)) {
            void message(tr(locale, 'Unsupported file. Use png, jpg, jpeg, or webp.', '未対応ファイルです。png/jpg/jpeg/webp を使用してください。'))
            return
          }
          const zone = resolveDropZoneFromPosition(payload.position)
          if (zone === 'logo' || zone === 'logo_tool') {
            setLogoFile(first)
            return
          }
          if (!zone && appTab === 'logo_tool') {
            setLogoFile(first)
            return
          }
          setInputFile(first)
        }
      })
      .then((unlisten) => {
        unlistenDrop = unlisten
      })

    return () => {
      if (unlistenDrop) {
        unlistenDrop()
      }
    }
  }, [appTab, locale])

  const pickImage = async (): Promise<string | null> => {
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
    return resolveSelection(selected)
  }

  const handlePickInput = async () => {
    try {
      const resolved = await pickImage()
      if (resolved) {
        setInputFile(resolved)
      }
    } catch (err) {
      await message(`${tr(locale, 'Failed to open file picker', 'ファイル選択に失敗しました')}: ${String(err)}`)
    }
  }

  const handlePickLogo = async () => {
    try {
      const resolved = await pickImage()
      if (resolved) {
        setLogoFile(resolved)
      }
    } catch (err) {
      await message(`${tr(locale, 'Failed to open file picker', 'ファイル選択に失敗しました')}: ${String(err)}`)
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
      await message(`${tr(locale, 'Failed to open folder picker', 'フォルダ選択に失敗しました')}: ${String(err)}`)
    }
  }

  const handlePickLogoOutput = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      })
      const resolved = resolveSelection(selected)
      if (resolved) {
        setLogoOutputDir(resolved)
      }
    } catch (err) {
      await message(`${tr(locale, 'Failed to open folder picker', 'フォルダ選択に失敗しました')}: ${String(err)}`)
    }
  }

  const handleExport = async () => {
    if (!inputPath || !outputDir) {
      await message(tr(locale, 'Select an input image and output location first.', '先に入力画像と出力先を選択してください。'))
      return
    }
    if (targetsToExport.length === 0) {
      await message(tr(locale, 'Select at least one output size.', '出力サイズを1つ以上選択してください。'))
      return
    }
    setIsBusy(true)
    setProgress(null)
    try {
      const exportedDir = await invoke<string>('export_images', {
        inputPath,
        logoPath: logoPath ?? null,
        templatePreset: selectedTemplate,
        outputDir,
        targets: targetsToExport,
        focus: focus ? { x: focus.x, y: focus.y } : null,
      })
      setLastOutputDir(exportedDir)
      await message(tr(locale, 'Export complete.', 'エクスポート完了'))
      try {
        await openPath(exportedDir)
      } catch (openErr) {
        await message(`${tr(locale, 'Exported, but failed to open folder', '出力は完了しましたがフォルダを開けませんでした')}: ${String(openErr)}`)
      }
    } catch (err) {
      await message(`${tr(locale, 'Export failed', 'エクスポートに失敗しました')}: ${String(err)}`)
    } finally {
      setIsBusy(false)
    }
  }

  const handleCreateTransparentLogo = async () => {
    if (!logoPath || !logoOutputDir) {
      await message(tr(locale, 'Select a logo image and output location first.', '先にロゴ画像と保存先を選択してください。'))
      return
    }
    setIsLogoBusy(true)
    try {
      const outputPath = await invoke<string>('create_transparent_logo', {
        logoPath,
        outputDir: logoOutputDir,
      })
      setLastLogoOutputPath(outputPath)
      await message(tr(locale, 'Transparent logo created.', '透過ロゴを作成しました。'))
      try {
        await openPath(outputPath)
      } catch (openErr) {
        await message(`${tr(locale, 'Created, but failed to open file', '作成しましたがファイルを開けませんでした')}: ${String(openErr)}`)
      }
    } catch (err) {
      await message(`${tr(locale, 'Transparent logo failed', '透過ロゴ作成に失敗しました')}: ${String(err)}`)
    } finally {
      setIsLogoBusy(false)
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

  const handleRememberOutputDir = (checked: boolean) => {
    setRememberOutputDir(checked)
    localStorage.setItem('rememberOutputDir', String(checked))
    if (checked && outputDir) {
      localStorage.setItem('outputDir', outputDir)
    }
    if (!checked) {
      localStorage.removeItem('outputDir')
    }
  }

  useEffect(() => {
    if (!rememberOutputDir) {
      return
    }
    if (outputDir) {
      localStorage.setItem('outputDir', outputDir)
    }
  }, [outputDir, rememberOutputDir])

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
      <div className="lang-switch" role="group" aria-label="Language switch">
        <button
          type="button"
          className={`lang-btn${locale === 'en' ? ' is-active' : ''}`}
          onClick={() => setLocale('en')}
        >
          English
        </button>
        <button
          type="button"
          className={`lang-btn${locale === 'ja' ? ' is-active' : ''}`}
          onClick={() => setLocale('ja')}
        >
          日本語
        </button>
      </div>
      <header className="hero">
        <p className="eyebrow">{tr(locale, 'Steam Image Exporter', 'Steam Image Exporter')}</p>
        <h1>{tr(locale, 'Generate every Steam size from a single key art image.', '1枚のキービジュアルからSteam向け各サイズを生成。')}</h1>
        <p className="lede">
          {tr(locale, 'Center-crop, Lanczos resize, PNG output. One click, no manual edits.', '中央切り抜き・Lanczosリサイズ・PNG出力。ワンクリックで作成。')}
        </p>
        <div className="hero__meta">
          <span className="pill">{tr(locale, 'Center crop', '中央切り抜き')}</span>
          <span className="pill">{tr(locale, 'Lanczos3 resize', 'Lanczos3リサイズ')}</span>
          <span className="pill">{tr(locale, 'PNG output', 'PNG出力')}</span>
        </div>
        <div className="tabs" role="tablist" aria-label={tr(locale, 'App tools', 'アプリ機能')}>
          <button
            type="button"
            role="tab"
            aria-selected={appTab === 'export'}
            className={`tab${appTab === 'export' ? ' is-active' : ''}`}
            onClick={() => setAppTab('export')}
          >
            {tr(locale, 'Export', 'エクスポート')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={appTab === 'logo_tool'}
            className={`tab${appTab === 'logo_tool' ? ' is-active' : ''}`}
            onClick={() => setAppTab('logo_tool')}
          >
            {tr(locale, 'Logo Transparency', 'ロゴ透過')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={appTab === 'template'}
            className={`tab${appTab === 'template' ? ' is-active' : ''}`}
            onClick={() => setAppTab('template')}
          >
            {tr(locale, 'Template Preview', 'テンプレート確認')}
          </button>
        </div>
      </header>

      {appTab === 'export' ? (
      <main className="layout">
        <section className="panel" aria-busy={isBusy}>
          <div className="step" style={stepStyle(0)}>
            <div className="step__row">
              <div>
                <p className="step__label">1 Input image</p>
                <p className="step__hint">{tr(locale, 'png, jpg, jpeg, webp', 'png, jpg, jpeg, webp')}</p>
              </div>
              <button
                className="button button--ghost"
                onClick={handlePickInput}
                disabled={isBusy}
              >
                {tr(locale, 'Choose image', '画像を選択')}
              </button>
            </div>
            <p className="path">{inputPath ?? tr(locale, 'Not selected', '未選択')}</p>
            <div
              ref={inputDropZoneRef}
              className={`drop-zone${activeDropZone === 'input' ? ' is-active' : ''}`}
            >
              {tr(locale, 'Drag & drop key art here', 'ここにキービジュアルをドラッグ&ドロップ')}
            </div>
          </div>

          <div className="step" style={stepStyle(20)}>
            <div className="step__row">
              <div>
                <p className="step__label">Logo image</p>
                <p className="step__hint">{tr(locale, 'Required for logo-overlay targets and library_logo.', 'ロゴ合成対象とlibrary_logoで使用します。')}</p>
              </div>
              <button
                className="button button--ghost"
                onClick={handlePickLogo}
                disabled={isBusy}
              >
                {tr(locale, 'Choose logo', 'ロゴを選択')}
              </button>
            </div>
            <p className="path">{logoPath ?? tr(locale, 'Not selected', '未選択')}</p>
            <div
              ref={logoDropZoneRef}
              className={`drop-zone${activeDropZone === 'logo' ? ' is-active' : ''}`}
            >
              {tr(locale, 'Drag & drop logo here', 'ここにロゴをドラッグ&ドロップ')}
            </div>
            <p className="drop-hint">{tr(locale, 'Used for logo-overlay targets and library_logo output.', 'ロゴ合成対象とlibrary_logoの出力に使用。')}</p>
          </div>

          {previewSrc ? (
            <div className="step step--preview" style={stepStyle(40)}>
              <div className="step__row">
                <div>
                  <p className="step__label">Focus point</p>
                  <p className="step__hint">
                    {tr(locale, 'Click the image to set focus. Default is center.', '画像をクリックして注目点を指定。未指定時は中央。')}
                  </p>
                </div>
                <button
                  className="button button--ghost"
                  onClick={() => setFocus(null)}
                  disabled={!focus || isBusy}
                >
                  {tr(locale, 'Reset focus', '注目点をリセット')}
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
                <p className="step__hint">{tr(locale, 'Choose how the output fills the frame.', 'フレームへの収め方を選択。')}</p>
              </div>
            </div>
            <div className="mode-select" role="group" aria-label={tr(locale, 'Export mode', '出力モード')}>
              {(Object.keys(MODE_LABELS) as Target['mode'][]).map((mode) => (
                <button
                  key={mode}
                  className={`mode-pill${exportMode === mode ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setExportMode(mode)}
                  disabled={isBusy}
                >
                  {modeLabel(locale, mode)}
                </button>
              ))}
            </div>
          </div>

          <div className="step" style={stepStyle(120)}>
            <div className="step__row">
              <div>
                <p className="step__label">2 Output drive</p>
                <p className="step__hint">
                  {tr(locale, 'A new folder is created inside the selected location.', '選択した場所に新しいフォルダを作成します。')}
                </p>
              </div>
              <button
                className="button button--ghost"
                onClick={handlePickOutput}
                disabled={isBusy}
              >
                {tr(locale, 'Choose location', '保存先を選択')}
              </button>
            </div>
            <p className="path">{outputDir ?? tr(locale, 'Not selected', '未選択')}</p>
            <label className="remember">
              <input
                type="checkbox"
                checked={rememberOutputDir}
                onChange={(event) => handleRememberOutputDir(event.target.checked)}
                disabled={isBusy}
              />
              {tr(locale, 'Remember output folder', '出力先を記憶')}
            </label>
            {lastOutputDir ? (
              <p className="path path--note">{tr(locale, 'Last output', '前回出力')}: {lastOutputDir}</p>
            ) : null}
          </div>

          <div className="step step--cta" style={stepStyle(200)}>
            <div className="step__row">
              <div>
                <p className="step__label">3 Export</p>
                <p className="step__hint">
                  {isBusy ? tr(locale, 'Processing images now.', '画像処理中です。') : tr(locale, 'Ready to generate.', '生成準備完了。')}
                </p>
              </div>
              <button
                className="button button--primary"
                onClick={handleExport}
                disabled={!canExport}
              >
                {isBusy ? tr(locale, 'Exporting...', '出力中...') : tr(locale, 'Export Steam Set', 'Steam用セットを出力')}
              </button>
            </div>
            <div className="status" data-busy={isBusy ? 'true' : 'false'}>
              <span className="status__dot" />
              <span>{progressLabel ?? (isBusy ? tr(locale, 'Working...', '処理中...') : tr(locale, 'Idle', '待機中'))}</span>
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
              <h2>{tr(locale, 'Steam preset', 'Steamプリセット')}</h2>
              <div className="card__actions">
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={selectAllTargets}
                  disabled={isBusy}
                >
                  {tr(locale, 'Select all', 'すべて選択')}
                </button>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={clearAllTargets}
                  disabled={isBusy}
                >
                  {tr(locale, 'Clear all', 'すべて解除')}
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
            <p>{'{name}_{width}x{height}_logo.png'}</p>
            <p className="note">
              {tr(locale, 'For logo targets, both base and `_logo` files are generated.', 'ロゴ対象は通常版と`_logo`版の2枚を出力します。')}
            </p>
          </div>
        </aside>
      </main>
      ) : appTab === 'logo_tool' ? (
        <main className="layout layout--single">
          <section className="panel" aria-busy={isLogoBusy}>
            <div className="step" style={stepStyle(0)}>
              <div className="step__row">
                <div>
                  <p className="step__label">1 Logo image</p>
                  <p className="step__hint">{tr(locale, 'png, jpg, jpeg, webp', 'png, jpg, jpeg, webp')}</p>
                </div>
                <button
                  className="button button--ghost"
                  onClick={handlePickLogo}
                  disabled={isLogoBusy}
                >
                  {tr(locale, 'Choose logo', 'ロゴを選択')}
                </button>
              </div>
              <p className="path">{logoPath ?? tr(locale, 'Not selected', '未選択')}</p>
              <div
                ref={logoToolDropZoneRef}
                className={`drop-zone${activeDropZone === 'logo_tool' ? ' is-active' : ''}`}
              >
                {tr(locale, 'Drag & drop logo here', 'ここにロゴをドラッグ&ドロップ')}
              </div>
            </div>

            <div className="step" style={stepStyle(40)}>
              <div className="step__row">
                <div>
                  <p className="step__label">2 Save location</p>
                  <p className="step__hint">{tr(locale, 'Transparent PNG is saved as a new file.', '透過PNGを新規ファイルとして保存します。')}</p>
                </div>
                <button
                  className="button button--ghost"
                  onClick={handlePickLogoOutput}
                  disabled={isLogoBusy}
                >
                  {tr(locale, 'Choose location', '保存先を選択')}
                </button>
              </div>
              <p className="path">{logoOutputDir ?? tr(locale, 'Not selected', '未選択')}</p>
              {lastLogoOutputPath ? (
                <p className="path path--note">{tr(locale, 'Last output', '前回出力')}: {lastLogoOutputPath}</p>
              ) : null}
            </div>

            {logoPreviewSrc ? (
              <div className="step step--preview" style={stepStyle(80)}>
                <div className="step__row">
                  <div>
                    <p className="step__label">Preview</p>
                    <p className="step__hint">{tr(locale, 'Use this to verify source before processing.', '処理前に元画像を確認してください。')}</p>
                  </div>
                </div>
                <div className="preview preview--checker">
                  <img src={logoPreviewSrc} alt="Logo preview" />
                </div>
              </div>
            ) : null}

            <div className="step step--cta" style={stepStyle(120)}>
              <div className="step__row">
                <div>
                  <p className="step__label">3 Create</p>
                  <p className="step__hint">
                    {isLogoBusy
                      ? tr(locale, 'Removing background now.', '背景を透過処理中です。')
                      : tr(locale, 'Auto-detect border color and save PNG.', '背景色を自動検知してPNG保存します。')}
                  </p>
                </div>
                <button
                  className="button button--primary"
                  onClick={handleCreateTransparentLogo}
                  disabled={!canCreateTransparentLogo}
                >
                  {isLogoBusy ? tr(locale, 'Processing...', '処理中...') : tr(locale, 'Create Transparent Logo', '透過ロゴを作成')}
                </button>
              </div>
            </div>
          </section>
        </main>
      ) : (
        <main className="layout layout--single">
          <section className="panel">
            <div className="step" style={stepStyle(0)}>
              <div className="step__row">
                <div>
                  <p className="step__label">Template</p>
                  <p className="step__hint">{tr(locale, 'Preview the 5 capsule images as one set.', '5種類カプセルを1セットで確認できます。')}</p>
                </div>
              </div>
              <div className="template-preset-list" role="radiogroup" aria-label={tr(locale, 'Logo template preset', 'ロゴテンプレート')}>
                {TEMPLATE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`template-preset${selectedTemplate === preset ? ' is-active' : ''}`}
                    onClick={() => setSelectedTemplate(preset)}
                  >
                    <div className="template-preset__preview" aria-hidden="true">
                      {canRenderTemplatePreview ? (
                        <>
                          <img
                            src={templateKeyartSrc}
                            alt=""
                            className="template-preset__preview-bg"
                          />
                          <img
                            src={templateLogoSrc}
                            alt=""
                            className="template-preset__preview-logo"
                            style={getTemplateOverlayStyle('header_capsule', preset)}
                          />
                        </>
                      ) : (
                        <span className="template-preset__preview-empty">
                          {tr(locale, 'Select key art + logo to preview', 'key art と logo を選択してプレビュー')}
                        </span>
                      )}
                    </div>
                    <span className="template-preset__title">{templatePresetMeta(locale, preset).title}</span>
                    <span className="template-preset__desc">{templatePresetMeta(locale, preset).description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="step" style={stepStyle(40)}>
              <div className="step__row">
                <div>
                  <p className="step__label">Inputs</p>
                  <p className="step__hint">{tr(locale, 'Swap images in this tab to check samples.', 'このタブで画像を差し替えてサンプル確認できます。')}</p>
                </div>
                <div className="card__actions">
                  <button
                    className="button button--ghost button--mini"
                    onClick={handlePickInput}
                  >
                    {tr(locale, 'Key art', 'キービジュアル')}
                  </button>
                  <button
                    className="button button--ghost button--mini"
                    onClick={handlePickLogo}
                  >
                    {tr(locale, 'Logo', 'ロゴ')}
                  </button>
                </div>
              </div>
              <p className="path">{tr(locale, 'Art', 'キービジュアル')}: {inputPath ?? tr(locale, 'Not selected', '未選択')}</p>
              <p className="path">{tr(locale, 'Logo', 'ロゴ')}: {logoPath ?? tr(locale, 'Not selected', '未選択')}</p>
            </div>

            {canRenderTemplatePreview ? (
              <div className="step step--preview" style={stepStyle(80)}>
                <div className="step__row">
                  <div>
                    <p className="step__label">Sample Set</p>
                    <p className="step__hint">{tr(locale, 'Preview header/small/main/vertical/library.', 'header/small/main/vertical/library の5点をプレビュー。')}</p>
                  </div>
                </div>
                <div className="template-grid">
                  {LOGO_TEMPLATE_TARGETS.map((target) => (
                    <figure key={target.name} className={`template-item template-item--${target.name}`}>
                      <div
                        className="template-item__canvas"
                        style={{ aspectRatio: `${target.w} / ${target.h}` }}
                      >
                        <img src={templateKeyartSrc} alt={`${target.name} base`} className="template-item__bg" />
                        <img
                          src={templateLogoSrc}
                          alt={`${target.name} logo`}
                          className="template-item__logo"
                          style={getTemplateOverlayStyle(target.name, selectedTemplate)}
                        />
                      </div>
                      <figcaption>{target.name} ({target.w}x{target.h})</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ) : (
              <div className="step" style={stepStyle(80)}>
                <p className="drop-hint">{tr(locale, 'If sample images fail to load, select key art and logo manually.', 'サンプル画像を読み込めない場合は key art と logo を選択してください。')}</p>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
