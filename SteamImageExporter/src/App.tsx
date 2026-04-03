import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, open } from '@tauri-apps/plugin-dialog'
import { open as openShell } from '@tauri-apps/plugin-shell'
import { APP_META } from './config/appMeta'
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

type PreflightResult = {
  issues: string[]
}

type TemplatePreviewCard = {
  preset: string
  data_url: string
}

type TemplatePreviewImage = {
  name: string
  width: number
  height: number
  data_url: string
}

type TemplatePreviewPayload = {
  cards: TemplatePreviewCard[]
  set: TemplatePreviewImage[]
}

type ReleaseInfo = {
  version: string
  title: string
  body: string
  url: string
}

type DropZoneType = 'input' | 'logo'
type AppTab = 'export' | 'template'
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
        description: tr(locale, 'Place logo at bottom-right corner.', '右下隅に配置。'),
      }
  }
}

const stepStyle = (delayMs: number): CSSVars => ({
  '--delay': `${delayMs}ms`,
})

const getTemplateOverlayStyle = (
  targetName: string,
  preset: TemplatePreset,
): CSSProperties => {
  const map: Record<TemplatePreset, Record<string, { width: number; left: number; top: number }>> = {
    balanced: {
      header_capsule: { width: 42, left: 50, top: 62 },
      small_capsule: { width: 50, left: 50, top: 66 },
      main_capsule: { width: 48, left: 50, top: 60 },
      vertical_capsule: { width: 70, left: 50, top: 34 },
      library_capsule: { width: 78, left: 50, top: 30 },
    },
    impact: {
      header_capsule: { width: 62, left: 50, top: 50 },
      small_capsule: { width: 62, left: 50, top: 52 },
      main_capsule: { width: 62, left: 50, top: 48 },
      vertical_capsule: { width: 78, left: 50, top: 38 },
      library_capsule: { width: 84, left: 50, top: 34 },
    },
    compact: {
      header_capsule: { width: 34, left: 50, top: 66 },
      small_capsule: { width: 42, left: 50, top: 68 },
      main_capsule: { width: 40, left: 50, top: 64 },
      vertical_capsule: { width: 62, left: 50, top: 36 },
      library_capsule: { width: 70, left: 50, top: 32 },
    },
    cinematic: {
      header_capsule: { width: 46, left: 50, top: 34 },
      small_capsule: { width: 56, left: 50, top: 36 },
      main_capsule: { width: 54, left: 50, top: 32 },
      vertical_capsule: { width: 72, left: 50, top: 24 },
      library_capsule: { width: 82, left: 50, top: 22 },
    },
    corner: {
      header_capsule: { width: 24, left: 82, top: 78 },
      small_capsule: { width: 28, left: 82, top: 78 },
      main_capsule: { width: 28, left: 82, top: 78 },
      vertical_capsule: { width: 46, left: 76, top: 82 },
      library_capsule: { width: 50, left: 76, top: 82 },
    },
  }
  const value = map[preset][targetName] ?? { width: 50, left: 50, top: 50 }
  return {
    width: `${value.width}%`,
    left: `${value.left}%`,
    top: `${value.top}%`,
    transform: 'translate(-50%, -50%)',
  }
}

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

const preflightIssueLabel = (locale: Locale, issue: string): string => {
  switch (issue) {
    case 'input_missing':
      return tr(locale, 'Input image is missing.', '入力画像が未設定です。')
    case 'input_not_found':
      return tr(locale, 'Input image could not be found.', '入力画像が見つかりません。')
    case 'input_not_readable':
      return tr(locale, 'Input image could not be opened.', '入力画像を開けません。')
    case 'targets_empty':
      return tr(locale, 'No output targets are selected.', '出力ターゲットが選択されていません。')
    case 'output_dir_missing':
      return tr(locale, 'Output folder is missing.', '出力先フォルダが見つかりません。')
    case 'output_dir_not_directory':
      return tr(locale, 'Selected output path is not a folder.', '選択した出力先がフォルダではありません。')
    case 'output_dir_not_writable':
      return tr(locale, 'Output folder is not writable.', '出力先フォルダに書き込めません。')
    case 'focus_out_of_bounds':
      return tr(locale, 'Focus point is outside the image bounds.', '注目点が画像範囲外です。')
    case 'logo_required':
      return tr(locale, 'A logo image is required for the selected outputs.', '選択した出力にはロゴ画像が必要です。')
    case 'logo_not_found':
      return tr(locale, 'Logo image could not be found.', 'ロゴ画像が見つかりません。')
    case 'logo_not_readable':
      return tr(locale, 'Logo image could not be opened.', 'ロゴ画像を開けません。')
    default:
      return issue
  }
}

const normalizeVersion = (value: string): string => (
  value.trim().replace(/^v/i, '').split('-')[0]
)

const compareVersions = (left: string, right: string): number => {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }
  return 0
}

const summarizeReleaseBody = (value: string): string => {
  const cleaned = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
  if (!cleaned) {
    return 'No release notes provided.'
  }
  if (cleaned.length <= 280) {
    return cleaned
  }
  return `${cleaned.slice(0, 277).trimEnd()}...`
}

function App() {
  const [locale, setLocale] = useState<Locale>('en')
  const [appTab, setAppTab] = useState<AppTab>('export')
  const [selectedTemplate, setSelectedTemplate] = useState<TemplatePreset>('balanced')
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [focus, setFocus] = useState<FocusPoint | null>(null)
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null)
  const [exportMode, setExportMode] = useState<Target['mode']>('fill')
  const [autoRemoveLogoBg, setAutoRemoveLogoBg] = useState(true)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    () => new Set(STEAM_TARGETS.map((target) => target.name)),
  )
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const inputDropZoneRef = useRef<HTMLDivElement | null>(null)
  const logoDropZoneRef = useRef<HTMLDivElement | null>(null)
  const [activeDropZone, setActiveDropZone] = useState<DropZoneType | null>(null)
  const activeDropZoneRef = useRef<DropZoneType | null>(null)
  const [progress, setProgress] = useState<ProgressPayload | null>(null)
  const [lastOutputDir, setLastOutputDir] = useState<string | null>(null)
  const [exportCompleted, setExportCompleted] = useState(false)
  const [templatePreview, setTemplatePreview] = useState<TemplatePreviewPayload | null>(null)
  const [templatePreviewBusy, setTemplatePreviewBusy] = useState(false)
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null)
  const [updatesBusy, setUpdatesBusy] = useState(false)
  const [updatesError, setUpdatesError] = useState<string | null>(null)

  const previewSrc = inputPath ? convertFileSrc(inputPath) : null
  const logoPreviewSrc = logoPath ? convertFileSrc(logoPath) : null
  const templateKeyartSrc = previewSrc ?? TEMPLATE_SAMPLE_KEYART
  const templateLogoSrc = logoPreviewSrc ?? TEMPLATE_SAMPLE_LOGO
  const currentVersion = APP_META.appVersion
  const targetsToExport = STEAM_TARGETS.filter((target) =>
    selectedNames.has(target.name),
  ).map((target) => ({
    ...target,
    mode: exportMode,
  }))
  const canExport = Boolean(inputPath && !isBusy)
  const isUpdateAvailable = latestRelease
    ? compareVersions(latestRelease.version, currentVersion) > 0
    : false
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
  const exportStatusLabel = (() => {
    if (!inputPath) return 'Waiting for key art'
    if (isBusy) return 'Generating…'
    if (exportCompleted) return 'Done'
    return 'Ready'
  })()

  const fetchLatestRelease = async () => {
    setUpdatesBusy(true)
    setUpdatesError(null)
    try {
      const response = await fetch(APP_META.githubReleasesApiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = await response.json() as {
        tag_name?: string
        name?: string
        body?: string
        html_url?: string
      }
      const version = normalizeVersion(payload.tag_name ?? payload.name ?? '')
      if (!version) {
        throw new Error('missing release version')
      }
      setLatestRelease({
        version,
        title: payload.name?.trim() || payload.tag_name?.trim() || `v${version}`,
        body: summarizeReleaseBody(payload.body ?? ''),
        url: payload.html_url ?? APP_META.githubReleasesUrl,
      })
    } catch (err) {
      console.error('Failed to fetch latest release', err)
      setLatestRelease(null)
      setUpdatesError(tr(locale, 'Could not fetch updates.', '更新情報を取得できませんでした。'))
    } finally {
      setUpdatesBusy(false)
    }
  }

  const handleOpenExternal = async (url: string) => {
    try {
      await openShell(url)
    } catch (err) {
      await message(`${tr(locale, 'Failed to open link', 'リンクを開けませんでした')}: ${String(err)}`)
    }
  }

  const setInputFile = (path: string) => {
    setInputPath(path)
    setFocus(null)
    setImageMeta(null)
    setExportCompleted(false)
  }

  const setLogoFile = (path: string) => {
    setLogoPath(path)
  }

  const resolveDropZoneFromPosition = (
    position: { x: number; y: number },
  ): DropZoneType | null => {
    const x = position.x
    const y = position.y
    const zones: Array<{ kind: DropZoneType; element: HTMLDivElement | null }> = [
      { kind: 'input', element: inputDropZoneRef.current },
      { kind: 'logo', element: logoDropZoneRef.current },
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

  const updateActiveDropZone = (zone: DropZoneType | null) => {
    activeDropZoneRef.current = zone
    setActiveDropZone(zone)
  }

  useEffect(() => {
    const storedLocale = localStorage.getItem('locale')
    if (storedLocale === 'en' || storedLocale === 'ja') {
      setLocale(storedLocale)
    }
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
    if (storedOutputDir) {
      setOutputDir(storedOutputDir)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('locale', locale)
  }, [locale])

  useEffect(() => {
    localStorage.setItem('logoTemplatePreset', selectedTemplate)
  }, [selectedTemplate])

  useEffect(() => {
    void fetchLatestRelease()
  }, [])

  useEffect(() => {
    if (appTab !== 'template') {
      return
    }
    let cancelled = false
    setTemplatePreviewBusy(true)
    setTemplatePreviewError(null)
    void invoke<TemplatePreviewPayload>('render_template_previews', {
      inputPath: inputPath ?? null,
      logoPath: logoPath ?? null,
      selectedPreset: selectedTemplate,
      focus: focus ? { x: focus.x, y: focus.y } : null,
      autoRemoveLogoBg,
    })
      .then((payload) => {
        if (cancelled) {
          return
        }
        setTemplatePreview(payload)
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setTemplatePreviewError(String(err))
      })
      .finally(() => {
        if (!cancelled) {
          setTemplatePreviewBusy(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [appTab, autoRemoveLogoBg, focus, inputPath, logoPath, selectedTemplate])

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
          updateActiveDropZone(resolveDropZoneFromPosition(payload.position))
          return
        }
        if (payload.type === 'leave') {
          updateActiveDropZone(null)
          return
        }
        if (payload.type === 'drop') {
          const zone = activeDropZoneRef.current ?? resolveDropZoneFromPosition(payload.position)
          updateActiveDropZone(null)
          const first = payload.paths[0]
          if (!first) {
            return
          }
          if (!isSupportedImagePath(first)) {
            void message(tr(locale, 'Unsupported file. Use png, jpg, jpeg, or webp.', '未対応ファイルです。png/jpg/jpeg/webp を使用してください。'))
            return
          }
          if (!zone) {
            void message(tr(locale, 'Drop the file onto the key art or logo field.', 'キーアート欄またはロゴ欄の上にドロップしてください。'))
            return
          }
          if (zone === 'logo') {
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
  }, [locale])

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

  const handleExport = async () => {
    if (!inputPath) {
      await message(tr(locale, 'Select an input image first.', '先に入力画像を選択してください。'))
      return
    }
    if (targetsToExport.length === 0) {
      await message(tr(locale, 'Select at least one output size.', '出力サイズを1つ以上選択してください。'))
      return
    }

    let exportOutputDir: string
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        defaultPath: outputDir ?? undefined,
      })
      const resolved = resolveSelection(selected)
      if (!resolved) {
        return
      }
      exportOutputDir = resolved
      setOutputDir(resolved)
      localStorage.setItem('outputDir', resolved)
    } catch (err) {
      await message(`${tr(locale, 'Failed to open folder picker', 'フォルダ選択に失敗しました')}: ${String(err)}`)
      return
    }

    try {
      const preflight = await invoke<PreflightResult>('preflight_export', {
        inputPath,
        logoPath: logoPath ?? null,
        templatePreset: selectedTemplate,
        outputDir: exportOutputDir,
        targets: targetsToExport,
        focus: focus ? { x: focus.x, y: focus.y } : null,
      })
      if (preflight.issues.length > 0) {
        const lines = preflight.issues.map((issue) => `- ${preflightIssueLabel(locale, issue)}`)
        await message(
          `${tr(locale, 'Please fix these issues before export:', 'エクスポート前に次を修正してください:')}\n\n${lines.join('\n')}`,
        )
        return
      }
    } catch (err) {
      await message(`${tr(locale, 'Preflight check failed', '事前チェックに失敗しました')}: ${String(err)}`)
      return
    }

    setIsBusy(true)
    setExportCompleted(false)
    setProgress(null)
    try {
      let logoPathForExport = logoPath ?? null
      if (logoPath && autoRemoveLogoBg) {
        logoPathForExport = await invoke<string>('create_transparent_logo', {
          logoPath,
          outputDir: exportOutputDir,
        })
      }
      const exportedDir = await invoke<string>('export_images', {
        inputPath,
        logoPath: logoPathForExport,
        templatePreset: selectedTemplate,
        outputDir: exportOutputDir,
        targets: targetsToExport,
        focus: focus ? { x: focus.x, y: focus.y } : null,
      })
      setLastOutputDir(exportedDir)
      setExportCompleted(true)
      await message(tr(locale, 'Export complete.', 'エクスポート完了'))
    } catch (err) {
      await message(`${tr(locale, 'Export failed', 'エクスポートに失敗しました')}: ${String(err)}`)
    } finally {
      setIsBusy(false)
    }
  }

  const handleOpenLastOutput = async () => {
    if (!lastOutputDir) {
      return
    }
    try {
      await openShell(lastOutputDir)
    } catch (err) {
      await message(`${tr(locale, 'Failed to open folder', 'フォルダを開けませんでした')}: ${String(err)}`)
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
      <div className="topbar">
        <div className="topbar__group" role="group" aria-label="Language switch">
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
        <button
          type="button"
          className="info-button"
          onClick={() => setIsInfoOpen(true)}
        >
          {tr(locale, 'Info', 'Info')}
          {isUpdateAvailable ? (
            <span className="info-button__badge">
              {tr(locale, 'NEW', 'NEW')}
            </span>
          ) : null}
        </button>
      </div>
      <header className="hero">
        <p className="eyebrow">{tr(locale, 'Steam Image Exporter', 'Steam Image Exporter')}</p>
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
            aria-selected={appTab === 'template'}
            className={`tab${appTab === 'template' ? ' is-active' : ''}`}
            onClick={() => setAppTab('template')}
          >
            {tr(locale, 'Template', 'テンプレート')}
          </button>
        </div>
      </header>

      {appTab === 'export' ? (
      <main className="layout layout--single">
        <section className="panel" aria-busy={isBusy}>
          <div className="step step--keyart" style={stepStyle(0)}>
            <div className="step__row">
              <div>
                <p className="step__label">{tr(locale, '1. Upload key art', '1. キーアートをアップロード')}</p>
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
            <label className="auto-toggle">
              <input
                type="checkbox"
                checked={autoRemoveLogoBg}
                onChange={(event) => setAutoRemoveLogoBg(event.target.checked)}
                disabled={isBusy}
              />
              {autoRemoveLogoBg
                ? tr(locale, 'Auto remove background (ON)', '背景透過を自動処理（ON）')
                : tr(locale, 'Auto remove background (OFF)', '背景透過を自動処理（OFF）')}
            </label>
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
                <p className="step__hint">{tr(locale, 'Recommended: Fill (crop)', '推奨: Fill（切り抜き）')}</p>
              </div>
            </div>
            <div className="mode-select" role="group" aria-label={tr(locale, 'Export mode', '出力モード')}>
              <button
                className={`mode-pill${exportMode === 'fill' ? ' is-active' : ''}`}
                type="button"
                onClick={() => setExportMode('fill')}
                disabled={isBusy}
              >
                {tr(locale, 'Recommended: Fill (crop)', '推奨: Fill（切り抜き）')}
              </button>
              <details className="mode-advanced">
                <summary>{tr(locale, 'More options', 'その他のオプション')}</summary>
                <div className="mode-advanced__list">
                  {(['fit', 'fit_extend'] as Target['mode'][]).map((mode) => (
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
              </details>
            </div>
          </div>

          <div className="step" style={stepStyle(120)}>
            <details className="preset-advanced">
              <summary>
                {selectedNames.size === STEAM_TARGETS.length
                  ? tr(locale, 'Steam outputs (All selected)', 'Steam出力（すべて選択中）')
                  : tr(locale, `Steam outputs (${selectedNames.size} selected)`, `Steam出力（${selectedNames.size}件選択中）`)}
              </summary>
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
            </details>
          </div>

          <div className="step step--cta" style={stepStyle(160)}>
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
                {isBusy ? tr(locale, 'Exporting...', '出力中...') : tr(locale, 'Generate all Steam images', 'Steam画像を一括生成')}
              </button>
            </div>
            <p className="cta-subnote">PNG files</p>
            <p className="note">
              {tr(locale, 'Files are named automatically for Steam.', 'ファイル名はSteam向けに自動設定されます。')}
            </p>
            {lastOutputDir ? (
              <p className="path path--note">{tr(locale, 'Last output', '前回出力')}: {lastOutputDir}</p>
            ) : null}
            <div className="card card--note">
              <h3>{tr(locale, 'Output naming', '出力ファイル名')}</h3>
              <p>{'{name}_{width}x{height}.png'}</p>
              <p>{'{name}_{width}x{height}_logo.png'}</p>
              <p className="note">
                {tr(locale, 'For logo targets, both base and `_logo` files are generated.', 'ロゴ対象は通常版と`_logo`版の2枚を出力します。')}
              </p>
            </div>
            <div className="status" data-busy={isBusy ? 'true' : 'false'}>
              <span className="status__dot" />
              <span>{progressLabel ?? exportStatusLabel}</span>
            </div>
            {exportCompleted && lastOutputDir ? (
              <div className="status-actions">
                <button
                  className="button button--ghost button--mini"
                  type="button"
                  onClick={handleOpenLastOutput}
                  disabled={isBusy}
                >
                  Reveal in Finder / Open folder
                </button>
              </div>
            ) : null}
            {isBusy ? (
              <div className="progress" style={progressStyle}>
                <span className="progress__bar" />
              </div>
            ) : null}
          </div>
        </section>
      </main>
      ) : (
      <main className="layout layout--single">
        <section className="panel">
          <div className="step" style={stepStyle(0)}>
            <div className="step__row">
              <div>
                <p className="step__label">{tr(locale, 'Template selection', 'テンプレート選択')}</p>
                <p className="step__hint">{tr(locale, 'Select a logo placement pattern for export.', '出力時のロゴ配置パターンを選択します。')}</p>
              </div>
            </div>
            <div className="template-preset-list" role="radiogroup" aria-label={tr(locale, 'Logo template preset', 'ロゴテンプレート')}>
              {TEMPLATE_PRESETS.map((preset) => (
                (() => {
                  const previewCard = templatePreview?.cards.find((card) => card.preset === preset)
                  return (
                    <button
                      key={preset}
                      type="button"
                      className={`template-preset${selectedTemplate === preset ? ' is-active' : ''}`}
                      onClick={() => setSelectedTemplate(preset)}
                    >
                      <div className="template-preset__preview" aria-hidden="true">
                        {previewCard ? (
                          <img
                            src={previewCard.data_url}
                            alt=""
                            className="template-preset__preview-bg"
                          />
                        ) : (
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
                        )}
                      </div>
                      <span className="template-preset__title">{templatePresetMeta(locale, preset).title}</span>
                      <span className="template-preset__desc">{templatePresetMeta(locale, preset).description}</span>
                    </button>
                  )
                })()
              ))}
            </div>
            {templatePreviewError ? (
              <p className="drop-hint">
                {tr(locale, 'Preview render failed.', 'プレビュー生成に失敗しました。')} {templatePreviewError}
              </p>
            ) : null}
            {!templatePreview && templatePreviewBusy ? (
              <p className="drop-hint">
                {tr(locale, 'Rendering high quality previews in the background.', '高品質プレビューをバックグラウンドで生成中です。')}
              </p>
            ) : null}
          </div>
          <div className="step step--preview" style={stepStyle(40)}>
            <div className="step__row">
              <div>
                <p className="step__label">{tr(locale, 'Preview set', 'プレビューセット')}</p>
                <p className="step__hint">{tr(locale, 'Header / Small / Main / Vertical / Library', 'Header / Small / Main / Vertical / Library')}</p>
              </div>
            </div>
            {templatePreview ? (
              <div className="template-grid">
                {templatePreview.set.map((target) => (
                  <figure key={target.name} className={`template-item template-item--${target.name}`}>
                    <div
                      className="template-item__canvas"
                      style={{ aspectRatio: `${target.width} / ${target.height}` }}
                    >
                      <img
                        src={target.data_url}
                        alt={`${target.name} preview`}
                        className="template-item__bg"
                      />
                    </div>
                    <figcaption>{target.name} ({target.width}x{target.height})</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="template-grid">
                {LOGO_TEMPLATE_TARGETS.map((target) => (
                  <figure key={target.name} className={`template-item template-item--${target.name}`}>
                    <div
                      className="template-item__canvas"
                      style={{ aspectRatio: `${target.w} / ${target.h}` }}
                    >
                      <img
                        src={templateKeyartSrc}
                        alt={`${target.name} preview`}
                        className="template-item__bg"
                      />
                      <img
                        src={templateLogoSrc}
                        alt=""
                        className="template-item__logo"
                        style={getTemplateOverlayStyle(target.name, selectedTemplate)}
                      />
                    </div>
                    <figcaption>{target.name} ({target.w}x{target.h})</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      )}

      {isInfoOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setIsInfoOpen(false)}
        >
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-panel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-panel__header">
              <div>
                <p className="modal-panel__eyebrow">{tr(locale, 'Info', 'Info')}</p>
                <h2 id="info-panel-title">{APP_META.appName}</h2>
              </div>
              <button
                type="button"
                className="button button--ghost button--mini"
                onClick={() => setIsInfoOpen(false)}
              >
                {tr(locale, 'Close', '閉じる')}
              </button>
            </div>

            <div className="modal-panel__section">
              <p className="modal-panel__meta">
                {tr(locale, 'By', '作者')}: {APP_META.authorName} · v{currentVersion}
              </p>
              <p className="note">{APP_META.authorBio}</p>
              <div className="modal-panel__actions">
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={() => void handleOpenExternal(APP_META.profileUrl)}
                >
                  {tr(locale, 'Profile', 'プロフィール')}
                </button>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={() => void handleOpenExternal(APP_META.githubRepoUrl)}
                >
                  GitHub Repo
                </button>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={() => void handleOpenExternal(APP_META.moreToolsUrl)}
                >
                  {tr(locale, 'More Tools', 'More Tools')}
                </button>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={() => void handleOpenExternal(APP_META.gumroadUrl)}
                >
                  Gumroad
                </button>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={() => void handleOpenExternal(APP_META.supportUrl)}
                >
                  {tr(locale, 'Support the creator', '作者を支援')}
                </button>
              </div>
            </div>

            <div className="modal-panel__section">
              <div className="modal-panel__row">
                <div>
                  <p className="step__label">{tr(locale, 'Updates', 'Updates')}</p>
                  <p className="step__hint">
                    {tr(locale, 'Checks the latest GitHub Release when needed.', '必要なときにGitHub Releasesの最新情報を確認します。')}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--mini"
                  onClick={() => void fetchLatestRelease()}
                  disabled={updatesBusy}
                >
                  {updatesBusy
                    ? tr(locale, 'Checking...', '確認中...')
                    : tr(locale, 'Check again', '再確認')}
                </button>
              </div>
              <div className="modal-panel__version-list">
                <p>
                  <span>{tr(locale, 'Current version', '現在のバージョン')}</span>
                  <strong>v{currentVersion}</strong>
                </p>
                <p>
                  <span>{tr(locale, 'Latest version', '最新バージョン')}</span>
                  <strong>{latestRelease ? `v${latestRelease.version}` : '—'}</strong>
                </p>
              </div>
              {isUpdateAvailable ? (
                <p className="update-pill">{tr(locale, 'Update available', '更新あり')}</p>
              ) : null}
              {latestRelease ? (
                <div className="modal-panel__release">
                  <p className="modal-panel__release-title">{latestRelease.title}</p>
                  <p className="note">{latestRelease.body}</p>
                  <button
                    type="button"
                    className="button button--ghost button--mini"
                    onClick={() => void handleOpenExternal(latestRelease.url)}
                  >
                    {tr(locale, 'Open Release Page', 'リリースページを開く')}
                  </button>
                </div>
              ) : null}
              {updatesError ? (
                <p className="drop-hint">{updatesError}</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
